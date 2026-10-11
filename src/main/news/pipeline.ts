// From cached raw items to the news cards shown in the UI:
// enabled providers → classify → drop removed (thumbs down) → expire → dedupe → select by domain
// weights → cards, plus every card marked useful (thumbs up), which skips expiry and selection.
// Items that mention a watchlist company skip the domain mix (only the per-group limit applies)
// and come first. Runs at view time, so edits in config.json or watchlist.json apply without
// refetching.

import { DOMAIN_LABELS, type DomainWeight, type NewsCard, type NewsTag } from '../../shared/types.js';
import type { AppConfig, ProviderInfo } from '../config.js';
import type { FeedCache, UsefulEntry } from '../state/appState.js';
import type { Classifier } from './classifier.js';
import { canonicalUrl, dedupe, itemId } from './dedupe.js';
import { selectForProfile, type Selectable } from './distribute.js';
import { effectiveDate, isExpired } from './expiry.js';
import type { RawItem } from './types.js';
import { WatchlistMatcher, isCompanyEvent } from './watchlist.js';

interface Candidate extends Selectable {
  item: RawItem;
  url: string;
  headline: string;
  /** 1 feeds, 2 GDELT, 3 Google News: on duplicates the lower layer's copy wins. */
  layer: number;
  /** Watchlist companies the item mentions. */
  watchlist: string[];
}


export interface NewsBuildInput {
  cache: FeedCache;
  config: AppConfig;
  weights: readonly DomainWeight[];
  classifier: Classifier;
  /** Enabled providers, in priority order. */
  providers: readonly ProviderInfo[];
  /** Watchlist company names (watchlist.json). */
  watchlist: readonly string[];
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
  const watch = new WatchlistMatcher(input.watchlist);
  const candidates: Candidate[] = [];

  for (const provider of input.providers) {
    for (const item of cache.sources[provider.id]?.items ?? []) {
      if (item.mock && !allowMock) continue;
      const canonical = canonicalUrl(item.url);
      // Removed for good; useful cards are added below from their saved copy.
      if (removed[canonical] !== undefined || useful[itemId(item.url)]) continue;
      const c = classifier.classify(item);
      const companies = watch.match(item);
      let tag = c?.tag ?? null;
      // A fair, expo, webinar or other event of a watchlist company counts as a career fair.
      if (companies.length > 0 && item.topic !== 'career_fair' && isCompanyEvent(item)) tag = 'career_fair';
      if (!tag) continue;
      let domain = c?.domain ?? 'all';
      if (domain === 'all' && item.queryDomain) domain = item.queryDomain;
      // A source dedicated to specific domains lends its domain to items no keyword matched.
      if (domain === 'all' && Array.isArray(provider.domains) && provider.domains.length > 0) {
        domain = provider.domains.find((d) => mixDomains.has(d)) ?? provider.domains[0];
      }
      // Such an event found in the news has no event date of its own, so it ages like news.
      const agesLikeNews = tag === 'career_fair' && item.topic !== 'career_fair' && !item.eventDate;
      if (isExpired(item, agesLikeNews ? 'hiring_growth' : tag, now, config.newsMaxAgeDays)) continue;
      candidates.push({ item, url: item.url, headline: item.headline, tag, domain, date: effectiveDate(item), eventDate: item.eventDate, sourceId: item.sourceId, layer: provider.layer, watchlist: companies });
    }
  }

  // Lower layers first so their copy survives deduplication, newest first within a layer.
  candidates.sort((a, b) => a.layer - b.layer || b.date - a.date);
  const unique = dedupe(candidates);
  // Watchlist items are not shared out by domain weight: newest (or soonest) first, per group.
  const watched = selectForProfile(unique.filter((c) => c.watchlist.length > 0), [], config.maxItemsPerTag);
  const others = selectForProfile(unique.filter((c) => c.watchlist.length === 0), weights, config.maxItemsPerTag);
  const selected = [...watched, ...others].map((c) => toCard(c, seen));
  const kept = Object.values(useful)
    .filter((u) => removed[canonicalUrl(u.url)] === undefined)
    .filter((u) => u.tag !== 'career_fair' || allowMock || !isMockUrl(u.url))
    .map((u) => usefulCard(u, seen, watch));
  const cards = [...selected, ...kept];

  const ordered = (list: NewsCard[]) => [
    ...list.filter((c) => c.tag !== 'career_fair').sort((a, b) => Date.parse(b.date) - Date.parse(a.date)),
    ...list.filter((c) => c.tag === 'career_fair').sort(fairOrder),
  ];
  return [...ordered(cards.filter((c) => c.watchlist.length > 0)), ...ordered(cards.filter((c) => c.watchlist.length === 0))];
}

const isMockUrl = (url: string) => url.startsWith('https://example.com/mock/');

/** Soonest event first; "date to be confirmed" last. */
function fairOrder(a: NewsCard, b: NewsCard): number {
  if (a.eventDate && b.eventDate) return a.eventDate.localeCompare(b.eventDate);
  if (a.eventDate) return -1;
  if (b.eventDate) return 1;
  return Date.parse(b.date) - Date.parse(a.date);
}

function usefulCard(u: UsefulEntry, seen: Readonly<Record<string, number>>, watch: WatchlistMatcher): NewsCard {
  const { markedAt: _markedAt, ...card } = u;
  // Entries saved before translation existed have no `translated` field. The watchlist label
  // follows the current watchlist.json, not the one at the time of the thumbs up.
  return {
    ...card,
    translated: card.translated ?? null,
    watchlist: watch.match({ headline: u.headline, excerpt: u.summary }),
    seenAt: seen[u.id] ?? null,
    useful: true,
  };
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
    translated: translationFor(c.item, c.tag),
    watchlist: c.watchlist,
  };
}

/** The card's English texts. Fair titles are names and stay as they are (also older cached ones). */
function translationFor(item: RawItem, tag: NewsTag): NewsCard['translated'] {
  const t = item.translation;
  const headline = tag === 'career_fair' ? null : (t?.headline ?? null);
  const summary = t?.excerpt ?? null;
  return headline || summary ? { headline, summary } : null;
}
