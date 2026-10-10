// Every news source is a provider behind one interface. Several providers feed the same list:
//   layer 1  the sources' own feeds and pages (RSS/Atom, or a small HTML adapter)
//   layer 2  GDELT DOC 2.0 search (no key)
//   layer 3  Google News RSS search (no key, unofficial), only as a fallback
// The refresh runs them, checks each response against the contract below, and records health.

import type { SourceTopic } from '../config.js';
import type { DomainId } from '../../shared/types.js';
import type { ParsedItem } from './types.js';

export interface DomainQuery {
  domain: DomainId;
  /** Words from config.json's keyword list for this domain. Never anything from the CV. */
  keywords: string[];
}

/** What a search provider looks for. Feed providers ignore it. */
export interface ProviderQuery {
  domains: DomainQuery[];
  /** Hiring and funding words from config.json (growth, cuts, funded). */
  signalKeywords: string[];
  maxAgeDays: number;
}

export interface NewsProvider {
  readonly id: string;
  readonly name: string;
  readonly layer: 1 | 2 | 3;
  /** How items are classified: `career_fair` and `funded_startup` sources are taken at their word; `hiring` items are scored on all signal keywords. */
  readonly topic: SourceTopic;
  readonly domains: 'all' | DomainId[];
  fetch(query: ProviderQuery): Promise<ParsedItem[]>;
}

/** The response broke the contract (missing title, link or date). The provider counts as failed. */
export class ContractError extends Error {
  override name = 'ContractError';
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Checks every item a provider returned. News items need a headline, an http(s) link and a
 * publication date; career fairs need a headline and a link, and their event date may be missing
 * ("date to be confirmed") but must be a real date when given.
 */
export function checkContract(items: readonly ParsedItem[], topic: SourceTopic): void {
  items.forEach((item, i) => {
    const where = `item ${i + 1}`;
    if (typeof item.headline !== 'string' || item.headline.trim() === '') throw new ContractError(`${where} has no title`);
    if (typeof item.url !== 'string' || !/^https?:\/\//i.test(item.url)) throw new ContractError(`${where} ("${item.headline}") has no valid link`);
    if (topic === 'career_fair') {
      for (const d of [item.eventDate, item.eventEndDate]) {
        if (d !== null && (typeof d !== 'string' || !ISO_DAY.test(d))) throw new ContractError(`${where} ("${item.headline}") has an unreadable event date`);
      }
    } else if (!item.publishedAt || Number.isNaN(Date.parse(item.publishedAt))) {
      throw new ContractError(`${where} ("${item.headline}") has no date`);
    }
  });
}
