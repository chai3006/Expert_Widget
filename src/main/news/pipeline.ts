// From cached raw items to the news cards shown in the UI:
// enabled sources → classify → expire → dedupe → select by domain weights → cards.
// Runs at view time, so keyword or source edits in config.json apply without refetching.

import { DOMAIN_LABELS, type DomainWeight, type NewsCard } from '../../shared/types.js';
import type { AppConfig } from '../config.js';
import type { FeedCache } from '../state/appState.js';
import type { Classifier } from './classifier.js';
import { dedupe, itemId } from './dedupe.js';
import { selectForProfile, type Selectable } from './distribute.js';
import { effectiveDate, isExpired } from './expiry.js';
import type { RawItem } from './types.js';

interface Candidate extends Selectable {
  item: RawItem;
  url: string;
  headline: string;
}

export interface NewsBuildInput {
  cache: FeedCache;
  config: AppConfig;
  weights: readonly DomainWeight[];
  classifier: Classifier;
  seen: Readonly<Record<string, number>>;
  now: number;
  /** Mock items are only ever allowed in mock mode. */
  allowMock: boolean;
}

export function buildNewsCards(input: NewsBuildInput): NewsCard[] {
  const { cache, config, weights, classifier, seen, now, allowMock } = input;
  const mixDomains = new Set(weights.map((w) => w.domain));
  const candidates: Candidate[] = [];

  for (const source of config.sources) {
    if (!source.enabled) continue;
    for (const item of cache.sources[source.id]?.items ?? []) {
      if (item.mock && !allowMock) continue;
      const c = classifier.classify(item);
      if (!c) continue;
      let domain = c.domain;
      // A source dedicated to specific domains lends its domain to items no keyword matched.
      if (domain === 'all' && Array.isArray(source.domains) && source.domains.length > 0) {
        domain = source.domains.find((d) => mixDomains.has(d)) ?? source.domains[0];
      }
      if (isExpired(item, c.tag, now, config.newsMaxAgeDays)) continue;
      candidates.push({ item, url: item.url, headline: item.headline, tag: c.tag, domain, date: effectiveDate(item), eventDate: item.eventDate, sourceId: item.sourceId });
    }
  }

  candidates.sort((a, b) => b.date - a.date);
  const selected = selectForProfile(dedupe(candidates), weights, config.maxItemsPerTag);

  const news = selected.filter((c) => c.tag !== 'career_fair').sort((a, b) => b.date - a.date);
  const fairs = selected.filter((c) => c.tag === 'career_fair');
  return [...news, ...fairs].map((c) => toCard(c, seen));
}

function toCard(c: Candidate, seen: Readonly<Record<string, number>>): NewsCard {
  const id = itemId(c.url);
  return {
    id,
    tag: c.tag,
    headline: c.item.headline,
    summary: c.item.excerpt,
    url: c.item.url,
    sourceName: c.item.sourceName,
    domain: c.domain,
    domainLabel: c.domain === 'all' ? 'All domains' : DOMAIN_LABELS[c.domain],
    date: new Date(c.date).toISOString(),
    eventDate: c.item.eventDate,
    eventEndDate: c.item.eventEndDate,
    seenAt: seen[id] ?? null,
  };
}
