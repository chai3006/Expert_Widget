// One Refresh, in order: read the CV and recompute the domain mix, then run the news providers.
// Layer 1 (feeds) and layer 2 (GDELT) run together; layer 3 (Google News) runs only for domains
// the search in layer 2 could not cover, and for each watchlist company. Searches are asked at most every SEARCH_MIN_GAP_MS (their
// index changes no faster), so Refresh can be pressed freely. A failing step or provider never stops the others, caches
// keep the last good data, and every provider's result is recorded as source health.

import { lastUpdatedLabel } from './shared/format.js';
import type { CvProfile, DomainId, DomainWeight, StatusMessage } from './shared/types.js';
import type { AppConfig } from './config.js';
import { buildProviderQuery } from './news/adapters/search.js';
import { canonicalUrl } from './news/dedupe.js';
import { FetchError } from '../../node/src/fetcher.js';
import { checkContract, type NewsProvider, type ProviderQuery } from './news/provider.js';
import type { ParsedItem, RawItem } from './news/types.js';
import { looksGerman, type Translator } from '../../node/src/translate/translator.js';
import type { AppStores, ProviderHealthRecord, SourceCache } from './state/appState.js';

export type CvResult = { ok: true; profile: CvProfile } | { ok: false; problem: string };

export interface CvProvider {
  readProfile(config: AppConfig, cvFolder: string): Promise<CvResult>;
}

export interface RefreshDeps {
  config: AppConfig;
  cvFolder: string;
  stores: AppStores;
  cv: CvProvider;
  /** Enabled providers, in priority order. */
  providers: NewsProvider[];
  /** Watchlist company names (watchlist.json). The searches look for each by name only. */
  watchlist?: readonly string[];
  isOnline: () => boolean;
  /** Translates new German headlines and summaries to English on this PC; null to skip. */
  translator?: Translator | null;
  now: () => number;
  /** Mock runs tag every item so they can never leak into a normal run's view. */
  mock: boolean;
}

const MAX_ITEMS_PER_SOURCE = 60;
const MAX_ITEMS_PER_SEARCH = 150;
const MAX_ITEMS_PER_COMPANY = 50;
export const NEEDS_ATTENTION_AFTER = 3;
/** GDELT updates its index every 15 minutes and throttles callers that ask more often. */
export const SEARCH_MIN_GAP_MS = 15 * 60_000;

type Outcome = { provider: NewsProvider; items: ParsedItem[] } | { provider: NewsProvider; error: Error };

export async function runRefresh(deps: RefreshDeps): Promise<StatusMessage[]> {
  const { stores, config } = deps;
  const messages: StatusMessage[] = [];
  const previousUpdate = stores.feed.value.lastUpdated;

  // 1. CV → domain mix. On failure keep the previous mix and say why.
  const cv = await deps.cv.readProfile(config, deps.cvFolder);
  if (cv.ok) {
    stores.profile.set({ version: 1, profile: cv.profile, lastProblem: null });
  } else {
    const previous = stores.profile.value.profile;
    const problem = previous ? `${cv.problem} Keeping the domain mix from ${previous.fileName}.` : cv.problem;
    stores.profile.set({ version: 1, profile: previous, lastProblem: problem });
  }
  const weights = stores.profile.value.profile?.weights ?? [];

  // 2. Which providers run. Search needs a domain mix or a watchlist to know what to search for.
  const query = buildProviderQuery(config, weights.map((w) => w.domain), deps.watchlist ?? []);
  const feeds = deps.providers.filter((p) => p.layer === 1 && sourceIsRelevant(p, weights));
  const cached = stores.feed.value.sources;
  const now = deps.now();
  const hasSearch = query.domains.length > 0 || query.companies.length > 0;
  const allSearches = hasSearch ? deps.providers.filter((p) => p.layer === 2) : [];
  const searches = allSearches.filter((p) => searchIsDue(cached[p.id], query, now));
  const fallbacks = hasSearch ? deps.providers.filter((p) => p.layer === 3) : [];

  if (feeds.length + searches.length + fallbacks.length > 0 && !deps.isOnline()) {
    messages.push(offlineMessage(previousUpdate, deps.now()));
    return messages;
  }

  // 3. Layers 1 and 2 together, then layer 3 for the domains the search left empty and the
  //    watchlist companies.
  const outcomes = await runAll([...feeds, ...searches], query);
  // A search that was not due still covers its domains with the items it found last time.
  const reused: Outcome[] = allSearches
    .filter((p) => !searches.includes(p) && cached[p.id]?.lastError === null && cached[p.id]?.fetchedAt !== null)
    .map((p) => ({ provider: p, items: cached[p.id].items }));
  const uncovered = uncoveredDomains(query, [...outcomes.filter((o) => o.provider.layer === 2), ...reused]);
  const fallbackQuery = { ...query, domains: query.domains.filter((d) => uncovered.includes(d.domain)) };
  const dueFallbacks = fallbacks.filter((p) => searchIsDue(cached[p.id], fallbackQuery, now));
  if (dueFallbacks.length > 0 && fallbackQuery.domains.length + fallbackQuery.companies.length > 0) {
    outcomes.push(...(await runAll(dueFallbacks, fallbackQuery)));
  }

  // 4. Caches and health.
  const fetchedAt = deps.now();
  const cache = { ...stores.feed.value.sources };
  const health = { ...stores.health.value.providers };
  const failures: Array<{ provider: NewsProvider; error: Error }> = [];
  for (const outcome of outcomes) {
    const { provider } = outcome;
    const previous: SourceCache = cache[provider.id] ?? { fetchedAt: null, items: [], lastError: null, lastErrorAt: null };
    const before = health[provider.id];
    if ('items' in outcome) {
      cache[provider.id] = {
        fetchedAt,
        items: toRawItems(capItems(outcome.items, provider.layer), provider, previous.items, fetchedAt, deps.mock),
        lastError: null,
        lastErrorAt: null,
        ...(provider.layer === 1 ? {} : { query: queryKey(provider.layer === 2 ? query : fallbackQuery) }),
      };
      health[provider.id] = { status: outcome.items.length > 0 ? 'ok' : 'empty', checkedAt: fetchedAt, itemCount: outcome.items.length, lastError: null, consecutiveFailures: 0 };
    } else {
      failures.push(outcome);
      cache[provider.id] = {
        ...previous,
        lastError: outcome.error.message,
        lastErrorAt: fetchedAt,
        ...(provider.layer === 1 ? {} : { query: queryKey(provider.layer === 2 ? query : fallbackQuery) }),
      };
      health[provider.id] = nextFailure(before, outcome.error.message, fetchedAt);
    }
  }

  // 5. English translations for items that do not have one yet (all on this PC).
  if (deps.translator && outcomes.length > failures.length) {
    try {
      await translateNew(cache, deps.translator);
    } catch (err) {
      messages.push({ level: 'info', text: `English translation is not available this time (${err instanceof Error ? err.message : String(err)}). Showing the original texts.` });
    } finally {
      await deps.translator.close().catch(() => undefined);
    }
  }

  const successes = outcomes.length - failures.length;
  const allOffline = failures.length > 0 && successes === 0 && failures.every((f) => f.error instanceof FetchError && (f.error.kind === 'offline' || f.error.kind === 'timeout'));
  const updated = successes > 0 || (outcomes.length === 0 && cv.ok);
  stores.feed.set({ version: 1, lastUpdated: updated ? fetchedAt : previousUpdate, sources: cache });
  if (!allOffline) stores.health.set({ version: 1, providers: health });

  if (allOffline) {
    messages.push(offlineMessage(previousUpdate, fetchedAt));
  } else if (failures.length > 0) {
    const list = failures
      .map((f) => `${f.provider.name} (${isRateLimited(f.error.message) ? `${f.error.message}; it will be asked again in ${SEARCH_MIN_GAP_MS / 60_000} minutes` : f.error.message})`)
      .join(', ');
    messages.push({
      level: 'warning',
      text: `${failures.length === 1 ? 'One source' : `${failures.length} sources`} could not be loaded: ${list}. Showing earlier items where available.`,
    });
  }
  return messages;
}

/** Feeds keep their first items; searches keep their first items per domain query and per company. */
export function capItems(items: readonly ParsedItem[], layer: 1 | 2 | 3): ParsedItem[] {
  if (layer === 1) return items.slice(0, MAX_ITEMS_PER_SOURCE);
  const perCompany = new Map<string, number>();
  const domainItems = items.filter((i) => i.queryCompany === undefined).slice(0, MAX_ITEMS_PER_SEARCH);
  const companyItems = items.filter((i) => {
    if (i.queryCompany === undefined) return false;
    const n = (perCompany.get(i.queryCompany) ?? 0) + 1;
    perCompany.set(i.queryCompany, n);
    return n <= MAX_ITEMS_PER_COMPANY;
  });
  return [...domainItems, ...companyItems];
}

/** Runs providers side by side; each response is checked against the contract. */
async function runAll(providers: NewsProvider[], query: ProviderQuery): Promise<Outcome[]> {
  const results = await Promise.allSettled(
    providers.map(async (p) => {
      const items = await p.fetch(query);
      checkContract(items, p.topic);
      return items;
    }),
  );
  return results.map((r, i) =>
    r.status === 'fulfilled'
      ? { provider: providers[i], items: r.value }
      : { provider: providers[i], error: r.reason instanceof Error ? r.reason : new Error(String(r.reason)) },
  );
}

/**
 * A search runs when it has never answered this query, when its last answer is older than
 * SEARCH_MIN_GAP_MS, or after a failure. After "too many requests" it waits the same gap.
 */
export function searchIsDue(cache: SourceCache | undefined, query: ProviderQuery, now: number): boolean {
  if (!cache || cache.query !== queryKey(query)) return true;
  if (cache.lastError === null) return cache.fetchedAt === null || now - cache.fetchedAt >= SEARCH_MIN_GAP_MS;
  if (isRateLimited(cache.lastError)) return cache.lastErrorAt === null || now - cache.lastErrorAt >= SEARCH_MIN_GAP_MS;
  return true;
}

function isRateLimited(error: string): boolean {
  return error.includes('HTTP 429');
}

export function queryKey(query: ProviderQuery): string {
  return JSON.stringify([query.domains, query.companies, query.signalKeywords, query.maxAgeDays]);
}

/** Domains with no usable search result: all of them when the search failed or did not run. */
export function uncoveredDomains(query: ProviderQuery, searchOutcomes: readonly Outcome[]): DomainId[] {
  const all = query.domains.map((d) => d.domain);
  const ok = searchOutcomes.filter((o): o is Extract<Outcome, { items: ParsedItem[] }> => 'items' in o);
  if (ok.length === 0) return all;
  const covered = new Set(ok.flatMap((o) => o.items.map((i) => i.queryDomain)));
  return all.filter((d) => !covered.has(d));
}

export function nextFailure(before: ProviderHealthRecord | undefined, error: string, at: number): ProviderHealthRecord {
  return {
    status: 'failed',
    checkedAt: at,
    itemCount: 0,
    lastError: error,
    consecutiveFailures: (before?.status === 'failed' ? before.consecutiveFailures : 0) + 1,
  };
}

export function offlineMessage(lastUpdated: number | null, now: number): StatusMessage {
  return lastUpdated
    ? { level: 'warning', text: `Offline, showing data from ${lastUpdatedLabel(lastUpdated, now)}` }
    : { level: 'warning', text: 'Offline. Connect to the internet and press Refresh.' };
}

/** A source limited to certain domains is only fetched when the CV mix includes one of them. */
export function sourceIsRelevant(source: Pick<NewsProvider, 'domains'>, weights: readonly DomainWeight[]): boolean {
  if (source.domains === 'all' || weights.length === 0) return true;
  return source.domains.some((d) => weights.some((w) => w.domain === d));
}

function toRawItems(parsed: ParsedItem[], provider: NewsProvider, previous: RawItem[], fetchedAt: number, mock: boolean): RawItem[] {
  const before = new Map(previous.map((p) => [canonicalUrl(p.url), p]));
  return parsed.map((p) => {
    const old = before.get(canonicalUrl(p.url));
    // A translation is reused as long as the source text is unchanged.
    const translation = old?.translation && old.headline === p.headline && old.excerpt === p.excerpt ? old.translation : undefined;
    return {
      ...p,
      sourceId: provider.id,
      sourceName: provider.name,
      topic: provider.topic,
      firstSeen: old?.firstSeen ?? fetchedAt,
      ...(translation ? { translation } : {}),
      ...(mock ? { mock: true as const } : {}),
    };
  });
}

/** Translates the German headlines and excerpts of cached items that have no translation yet. */
export async function translateNew(cache: Record<string, SourceCache>, translator: Translator): Promise<number> {
  const jobs: Array<{ item: RawItem; field: 'headline' | 'excerpt' }> = [];
  for (const source of Object.values(cache)) {
    for (const item of source.items) {
      if (item.translation) continue;
      // Career fair titles are event names ("A-Zu-Bi! Neuburg"); only their descriptions are translated.
      if (item.topic !== 'career_fair' && looksGerman(item.headline)) jobs.push({ item, field: 'headline' });
      if (item.excerpt && looksGerman(item.excerpt)) jobs.push({ item, field: 'excerpt' });
      // Texts that are already English get an empty translation, so they are not checked again.
      item.translation = { headline: null, excerpt: null };
    }
  }
  if (jobs.length === 0) return 0;
  try {
    const out = await translator.translate(jobs.map((j) => j.item[j.field]));
    jobs.forEach((j, i) => {
      const text = out[i]?.trim();
      if (text) j.item.translation = { ...j.item.translation!, [j.field]: text };
    });
  } catch (err) {
    // Try again on the next Refresh.
    for (const j of jobs) delete j.item.translation;
    throw err;
  }
  return jobs.length;
}
