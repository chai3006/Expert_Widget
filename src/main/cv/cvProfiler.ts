// Turns CV text into a domain mix. `CvProfiler` is the seam for a future AI-based profiler; the
// rule-based implementation below scores keyword hits from config.json.

import type { DomainId, DomainWeight } from '../../shared/types.js';
import { KeywordMatcher, foldText } from '../text/keywords.js';

export interface CvProfiler {
  /** Returns at most 4 domains with whole-number weights summing to 100, highest first. Empty if nothing matched. */
  computeWeights(cvText: string): Promise<DomainWeight[]>;
}

export const MIN_SHARE_PERCENT = 5;
export const MAX_DOMAINS = 4;

export class RuleBasedCvProfiler implements CvProfiler {
  private readonly matchers: Array<{ domain: DomainId; matcher: KeywordMatcher }>;

  /** `domainKeywords` insertion order is the tie-break order. */
  constructor(domainKeywords: Partial<Record<DomainId, readonly string[]>>, private readonly order: readonly DomainId[]) {
    this.matchers = (Object.entries(domainKeywords) as Array<[DomainId, string[]]>).map(([domain, kws]) => ({
      domain,
      matcher: new KeywordMatcher(kws),
    }));
  }

  scoreHits(cvText: string): Map<DomainId, number> {
    const folded = foldText(cvText);
    const hits = new Map<DomainId, number>();
    for (const { domain, matcher } of this.matchers) hits.set(domain, matcher.countFolded(folded));
    return hits;
  }

  async computeWeights(cvText: string): Promise<DomainWeight[]> {
    return computeDomainMix(this.scoreHits(cvText), this.order);
  }
}

/**
 * Domain mix from keyword hits:
 * 1. share = hits / total hits; drop domains below 5 %.
 * 2. Rank by hits (ties: config order) and keep the top 4.
 * 3. Re-normalise to whole numbers summing to 100 (largest remainder; ties: rank order).
 */
export function computeDomainMix(hits: ReadonlyMap<DomainId, number>, order: readonly DomainId[]): DomainWeight[] {
  const rank = (d: DomainId) => {
    const i = order.indexOf(d);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  const total = [...hits.values()].reduce((a, b) => a + b, 0);
  if (total <= 0) return [];

  const kept = [...hits.entries()]
    .filter(([, h]) => h > 0 && (h / total) * 100 >= MIN_SHARE_PERCENT)
    .sort((a, b) => b[1] - a[1] || rank(a[0]) - rank(b[0]))
    .slice(0, MAX_DOMAINS);

  const keptTotal = kept.reduce((a, [, h]) => a + h, 0);
  const exact = kept.map(([domain, h], i) => ({ domain, i, exact: (h / keptTotal) * 100 }));
  const result = exact.map((e) => ({ ...e, weight: Math.floor(e.exact) }));
  let remaining = 100 - result.reduce((a, r) => a + r.weight, 0);
  const byRemainder = [...result].sort((a, b) => b.exact - b.weight - (a.exact - a.weight) || a.i - b.i);
  for (const r of byRemainder) {
    if (remaining <= 0) break;
    r.weight += 1;
    remaining -= 1;
  }
  return result
    .sort((a, b) => b.weight - a.weight || a.i - b.i)
    .map(({ domain, weight }) => ({ domain, weight }));
}
