// From cached raw items to the news cards shown in the UI:
// enabled providers → classify → drop removed (thumbs down) → expire → dedupe → select by domain
// weights → cards, plus every card marked useful (thumbs up), which skips expiry and selection.
// Runs at view time, so keyword or source edits in config.json apply without refetching.

import { DOMAIN_LABELS, type DomainWeight, type NewsCard, type NewsTag } from '../../shared/types.js';
import type { AppConfig, ProviderInfo } from '../config.js';
import type { FeedCache, UsefulEntry } from '../state/appState.js';
import type { Classifier } from './classifier.js';
import { canonicalUrl, dedupe, itemId } from './dedupe.js';
import { selectForProfile, type Selectable } from './distribute.js';
import { effectiveDate, isExpired } from './expiry.js';
import type { RawItem } from './types.js';

interface Candidate extends Selectable {
  item: RawItem;
  url: string;
  headline: string;
  /** 1 feeds, 2 GDELT, 3 Google News: on duplicates the lower layer's copy wins. */
  layer: number;
}


export interface NewsBuildInput {
  cache: FeedCache;
  config: AppConfig;
  weights: readonly DomainWeight[];
  classifier: Classifier;
  /** Enabled providers, in priority order. */
  providers: readonly ProviderInfo[];
  seen: Readonly<Record<string, number>>;
  /** Thumbs down, by canonical URL. */
  removed: Readonly<Record<string, number>>;
  /** Thumbs up, by card id. */
  useful: Readonly<Record<string, UsefulEntry>>;
  now: number;
  /** Mock items are only ever allowed in mock mode. */
  allowMock: boolean;
}

export function buildNewsCards(input: NewsBuildInput): NewsCard[] {
  const { cache, config, weights, classifier, seen, removed, useful, now, allowMock } = input;
  const mixDomains = new Set(weights.map((w) => w.domain));
  const candidates: Candidate[] = [];

  for (const provider of input.providers) {
    for (const item of cache.sources[provider.id]?.items ?? []) {
      if (item.mock && !allowMock) continue;
      const canonical = canonicalUrl(item.url);
      // Removed for good; useful cards are added below from their saved copy.
      if (removed[canonical] !== undefined || useful[itemId(item.url)]) continue;
      const c = classifier.classify(item);
      if (!c) continue;
      let domain = c.domain;
      if (domain === 'all' && item.queryDomain) domain = item.queryDomain;
      // A source dedicated to specific domains lends its domain to items no keyword matched.
      if (domain === 'all' && Array.isArray(provider.domains) && provider.domains.length > 0) {
        domain = provider.domains.find((d) => mixDomains.has(d)) ?? provider.domains[0];
      }
      if (isExpired(item, c.tag, now, config.newsMaxAgeDays)) continue;
      candidates.push({ item, url: item.url, headline: item.headline, tag: c.tag, domain, date: effectiveDate(item), eventDate: item.eventDate, sourceId: item.sourceId, layer: provider.layer });
    }
  }

  // Lower layers first so their copy survives deduplication, newest first within a layer.
  candidates.sort((a, b) => a.layer - b.layer || b.date - a.date);
  const selected = selectForProfile(dedupe(candidates), weights, config.maxItemsPerTag).map((c) => toCard(c, seen));
  const kept = Object.values(useful)
    .filter((u) => removed[canonicalUrl(u.url)] === undefined)
    .filter((u) => u.tag !== 'career_fair' || allowMock || !isMockUrl(u.url))
    .map((u) => usefulCard(u, seen));
  const cards = [...selected, ...kept];

  const news = cards.filter((c) => c.tag !== 'career_fair').sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  const fairs = cards.filter((c) => c.tag === 'career_fair').sort(fairOrder);
  return [...news, ...fairs];
}

const isMockUrl = (url: string) => url.startsWith('https://example.com/mock/');

/** Soonest event first; "date to be confirmed" last. */
function fairOrder(a: NewsCard, b: NewsCard): number {
  if (a.eventDate && b.eventDate) return a.eventDate.localeCompare(b.eventDate);
  if (a.eventDate) return -1;
  if (b.eventDate) return 1;
  return Date.parse(b.date) - Date.parse(a.date);
}

function usefulCard(u: UsefulEntry, seen: Readonly<Record<string, number>>): NewsCard {
  const { markedAt: _markedAt, ...card } = u;
  // Entries saved before translation existed have no `translated` field.
  return { ...card, translated: card.translated ?? null, seenAt: seen[u.id] ?? null, useful: true };
}

function toCard(c: Candidate, seen: Readonly<Record<string, number>>): NewsCard {
  const id = itemId(c.url);
  return {
    id,
    tag: c.tag as NewsTag,
    headline: c.item.headline,
    summary: c.item.excerpt,
    url: c.item.url,
    sourceName: c.item.publisher ?? c.item.sourceName,
    domain: c.domain,
    domainLabel: c.domain === 'all' ? 'All domains' : DOMAIN_LABELS[c.domain],
    date: new Date(c.date).toISOString(),
    eventDate: c.item.eventDate,
    eventEndDate: c.item.eventEndDate,
    seenAt: seen[id] ?? null,
    useful: false,
    translated: c.item.translation && (c.item.translation.headline || c.item.translation.excerpt)
      ? { headline: c.item.translation.headline, summary: c.item.translation.excerpt }
      : null,
  };
}
