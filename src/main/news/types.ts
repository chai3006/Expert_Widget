import type { SourceTopic } from '../config.js';
import type { DomainId, NewsTag } from '../../shared/types.js';

/** What a source adapter extracts from a page or feed. Headline and short excerpt only, never article text. */
export interface ParsedItem {
  url: string;
  headline: string;
  excerpt: string;
  /** ISO timestamp of publication, if the source gives one. */
  publishedAt: string | null;
  /** Career fairs: ISO dates (yyyy-mm-dd); null when the source gives no date. */
  eventDate: string | null;
  eventEndDate: string | null;
  /** Set when the source itself says what kind of signal this is (e.g. Eurofound job loss vs creation). */
  tagHint?: NewsTag;
  /** Search providers: the publisher's site (e.g. "spiegel.de"), shown as the card's source. */
  publisher?: string;
  /** Search providers: the domain whose keywords the query used; fallback when no keyword matches the headline. */
  queryDomain?: DomainId;
}

/** A parsed item as stored in the feed cache. */
export interface RawItem extends ParsedItem {
  sourceId: string;
  sourceName: string;
  topic: SourceTopic;
  /** When this URL was first fetched; stands in for the date when the source gives none. */
  firstSeen: number;
  /** Only ever set by the built-in mock data. Normal runs drop such items. */
  mock?: true;
}

export type SourceAdapter = (body: string, pageUrl: string) => ParsedItem[];
