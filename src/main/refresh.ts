// One Refresh, in order: read the CV and recompute the domain mix, then fetch every enabled
// source. A failing step or source never stops the others; caches keep the last good data.

import { lastUpdatedLabel } from '../shared/format.js';
import type { CvProfile, DomainWeight, StatusMessage } from '../shared/types.js';
import type { AppConfig, SourceConfig } from './config.js';
import { canonicalUrl } from './news/dedupe.js';
import { FetchError } from './news/fetcher.js';
import type { ParsedItem, RawItem } from './news/types.js';
import type { AppStores, SourceCache } from './state/appState.js';

export type CvResult = { ok: true; profile: CvProfile } | { ok: false; problem: string };

export interface CvProvider {
  readProfile(config: AppConfig, cvFolder: string): Promise<CvResult>;
}

export interface NewsProvider {
  isOnline(): boolean;
  fetchSource(source: SourceConfig): Promise<ParsedItem[]>;
}

export interface RefreshDeps {
  config: AppConfig;
  cvFolder: string;
  stores: AppStores;
  cv: CvProvider;
  news: NewsProvider;
  now: () => number;
  /** Mock runs tag every item so they can never leak into a normal run's view. */
  mock: boolean;
}

const MAX_ITEMS_PER_SOURCE = 60;

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

  // 2. News sources.
  const sources = config.sources.filter((s) => s.enabled && sourceIsRelevant(s, weights));
  const cache = { ...stores.feed.value.sources };
  const failures: Array<{ source: SourceConfig; error: FetchError | Error }> = [];
  let successes = 0;

  if (sources.length > 0 && !deps.news.isOnline()) {
    messages.push(offlineMessage(previousUpdate, deps.now()));
    return messages;
  }

  const results = await Promise.allSettled(sources.map((s) => deps.news.fetchSource(s)));
  const fetchedAt = deps.now();
  results.forEach((result, i) => {
    const source = sources[i];
    const previous: SourceCache = cache[source.id] ?? { fetchedAt: null, items: [], lastError: null, lastErrorAt: null };
    if (result.status === 'fulfilled') {
      successes++;
      cache[source.id] = { fetchedAt, items: toRawItems(result.value, source, previous.items, fetchedAt, deps.mock), lastError: null, lastErrorAt: null };
    } else {
      const error = result.reason instanceof Error ? result.reason : new Error(String(result.reason));
      failures.push({ source, error });
      cache[source.id] = { ...previous, lastError: error.message, lastErrorAt: fetchedAt };
    }
  });

  const allOffline = failures.length > 0 && successes === 0 && failures.every((f) => f.error instanceof FetchError && (f.error.kind === 'offline' || f.error.kind === 'timeout'));
  const cvChanged = cv.ok;
  const updated = successes > 0 || (sources.length === 0 && cvChanged);
  stores.feed.set({ version: 1, lastUpdated: updated ? fetchedAt : previousUpdate, sources: cache });

  if (allOffline) {
    messages.push(offlineMessage(previousUpdate, fetchedAt));
  } else if (failures.length > 0) {
    const list = failures.map((f) => `${f.source.name} (${f.error.message})`).join(', ');
    messages.push({
      level: 'warning',
      text: `${failures.length === 1 ? 'One source' : `${failures.length} sources`} could not be loaded: ${list}. Showing earlier items where available.`,
    });
  }
  return messages;
}

export function offlineMessage(lastUpdated: number | null, now: number): StatusMessage {
  return lastUpdated
    ? { level: 'warning', text: `Offline, showing data from ${lastUpdatedLabel(lastUpdated, now)}` }
    : { level: 'warning', text: 'Offline. Connect to the internet and press Refresh.' };
}

/** A source limited to certain domains is only fetched when the CV mix includes one of them. */
export function sourceIsRelevant(source: SourceConfig, weights: readonly DomainWeight[]): boolean {
  if (source.domains === 'all' || weights.length === 0) return true;
  return source.domains.some((d) => weights.some((w) => w.domain === d));
}

function toRawItems(parsed: ParsedItem[], source: SourceConfig, previous: RawItem[], fetchedAt: number, mock: boolean): RawItem[] {
  const firstSeen = new Map(previous.map((p) => [canonicalUrl(p.url), p.firstSeen]));
  return parsed.slice(0, MAX_ITEMS_PER_SOURCE).map((p) => ({
    ...p,
    sourceId: source.id,
    sourceName: source.name,
    topic: source.topic,
    firstSeen: firstSeen.get(canonicalUrl(p.url)) ?? fetchedAt,
    ...(mock ? { mock: true as const } : {}),
  }));
}
