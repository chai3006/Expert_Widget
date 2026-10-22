// Tags a news item and matches it to a domain. `Classifier` is the seam for a future AI-based
// classifier; the rule-based one uses only the keyword lists in config.json.

import type { AppConfig, ScoredTag } from '../config.js';
import type { DomainId, ItemDomain, NewsTag } from '../shared/types.js';
import { KeywordMatcher, containsAny, foldText } from '../text/keywords.js';
import { TermMatcher } from '../text/terms.js';
import type { RawItem } from './types.js';

export interface Classification {
  tag: NewsTag;
  domain: ItemDomain;
}

export interface Classifier {
  /** Returns null when the item is not a signal this widget shows. */
  classify(item: RawItem): Classification | null;
}

// Tie-break order when two tags score the same: cuts are the stronger signal.
const TAG_PRIORITY: ScoredTag[] = ['hiring_cuts', 'hiring_growth', 'funded_startup'];

export class RuleBasedClassifier implements Classifier {
  private readonly tagMatchers: Record<ScoredTag, KeywordMatcher>;
  private readonly domainMatchers: Array<{ domain: DomainId; matcher: TermMatcher }>;
  private readonly fairExclude: string[];

  constructor(keywords: AppConfig['keywords']) {
    this.tagMatchers = {
      hiring_cuts: new KeywordMatcher(keywords.tags.hiring_cuts),
      hiring_growth: new KeywordMatcher(keywords.tags.hiring_growth),
      funded_startup: new KeywordMatcher(keywords.tags.funded_startup),
    };
    this.domainMatchers = (Object.entries(keywords.domains) as Array<[DomainId, string[]]>).map(([domain, kws]) => ({
      domain,
      // Same matching as for CVs: plurals and umlauts ("Pflegekräfte"), endings ("Hotels"), compounds.
      matcher: new TermMatcher(kws.map((term) => ({ term, weight: 1 }))),
    }));
    this.fairExclude = keywords.fairExclude;
  }

  classify(item: RawItem): Classification | null {
    const text = foldText(`${item.headline} ${item.excerpt}`);
    const tag = this.tagFor(item, text);
    return tag ? { tag, domain: this.domainFor(text) } : null;
  }

  private tagFor(item: RawItem, folded: string): NewsTag | null {
    if (item.topic === 'career_fair') {
      // Apprenticeship and school-leaver fairs are not for experienced engineers.
      return containsAny(item.headline, this.fairExclude) ? null : 'career_fair';
    }
    if (item.tagHint) return item.tagHint;

    if (item.topic === 'funded_startup') {
      return this.tagMatchers.funded_startup.countFolded(folded) > 0 ? 'funded_startup' : null;
    }
    let best: ScoredTag | null = null;
    let bestHits = 0;
    for (const tag of TAG_PRIORITY) {
      const hits = this.tagMatchers[tag].countFolded(folded);
      if (hits > bestHits) {
        best = tag;
        bestHits = hits;
      }
    }
    return best;
  }

  /** Domain with the most keyword hits (ties: config order), or `all` when none matched. */
  domainFor(folded: string): ItemDomain {
    let best: ItemDomain = 'all';
    let bestHits = 0;
    for (const { domain, matcher } of this.domainMatchers) {
      const hits = matcher.countFolded(folded);
      if (hits > bestHits) {
        best = domain;
        bestHits = hits;
      }
    }
    return best;
  }
}
