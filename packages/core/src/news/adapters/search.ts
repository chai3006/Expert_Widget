// Search providers (layers 2 and 3): building queries and parsing the answers.
//
// Privacy: the queries are the fixed broad topics of data/news.json plus the signal words, the same
// for every user whatever their CV says, and, unless switched off, one query per watchlist company
// name (the only words the user chose). buildProviderQuery is not given the domain mix at all; the
// results are filtered and ranked by the domain mix on this computer. test/privacy.test.ts checks it.

import * as cheerio from 'cheerio/slim';
import { base64ToLatin1 } from '../../hash.js';
import type { AppConfig } from '../../config.js';
import type { ProviderQuery, TopicQuery } from '../provider.js';
import { ContractError } from '../provider.js';
import type { ParsedItem } from '../types.js';
import { cleanText, htmlToText, toIsoTimestamp } from '../text.js';

const TOPIC_TERMS = 8;
const SIGNAL_TERMS_PER_TAG = 5;

/**
 * Keywords both services accept as plain words or quoted phrases: letters, digits, spaces and
 * hyphens, at least 4 characters (GDELT rejects very short words; short acronyms are ambiguous).
 */
export function isSearchableKeyword(k: string): boolean {
  return k.length >= 4 && /^[\p{L}\p{N}][\p{L}\p{N} -]*[\p{L}\p{N}]$/u.test(k);
}

function pick(list: readonly string[] | undefined, n: number): string[] {
  return (list ?? []).filter(isSearchableKeyword).slice(0, n);
}

/**
 * One query per broad topic of data/news.json, and one per watchlist company. Company names the
 * services cannot take as a phrase (see isSearchableKeyword) are not searched; news from the feeds
 * still matches them.
 */
export function buildProviderQuery(config: AppConfig, companies: readonly string[] = []): ProviderQuery {
  const topics: TopicQuery[] = config.search.topics
    .map((t) => ({ topic: t.id, keywords: pick(t.keywords, TOPIC_TERMS) }))
    .filter((q) => q.keywords.length > 0);
  const t = config.keywords.tags;
  const signalKeywords = [...pick(t.hiring_cuts, SIGNAL_TERMS_PER_TAG), ...pick(t.hiring_growth, SIGNAL_TERMS_PER_TAG), ...pick(t.funded_startup, SIGNAL_TERMS_PER_TAG)];
  return { topics, companies: companies.filter(isSearchableKeyword), signalKeywords, maxAgeDays: config.newsMaxAgeDays };
}

const term = (k: string) => (k.includes(' ') ? `"${k}"` : k);
const orGroup = (list: readonly string[]) => (list.length === 1 ? term(list[0]) : `(${list.map(term).join(' OR ')})`);

// ---- GDELT DOC 2.0 ---------------------------------------------------------------------------

export const GDELT_ENDPOINT = 'https://api.gdeltproject.org/api/v2/doc/doc';

/**
 * GDELT query syntax (blog.gdeltproject.org/gdelt-doc-2-0-api-debuts): OR blocks in parentheses
 * with upper-case OR, not nested; phrases in double quotes; sourcecountry: takes the country name
 * without spaces; sourcelang: the language name. Terms separated by spaces must all match.
 */
export function gdeltUrl(q: TopicQuery, signalKeywords: readonly string[], maxAgeDays: number, maxRecords = 75): string {
  const query = [orGroup(q.keywords), orGroup(signalKeywords), 'sourcecountry:germany', 'sourcelang:german'].join(' ');
  const params = new URLSearchParams({
    query,
    mode: 'artlist',
    format: 'json',
    maxrecords: String(maxRecords),
    timespan: `${maxAgeDays}d`,
    sort: 'datedesc',
  });
  return `${GDELT_ENDPOINT}?${params.toString()}`;
}

/**
 * A watchlist company by name alone, as a phrase. No country or language filter: the exact name
 * is specific enough, and news about a startup is often in English.
 */
export function gdeltCompanyUrl(name: string, maxAgeDays: number, maxRecords = 75): string {
  const params = new URLSearchParams({
    query: `"${name}"`,
    mode: 'artlist',
    format: 'json',
    maxrecords: String(maxRecords),
    timespan: `${maxAgeDays}d`,
    sort: 'datedesc',
  });
  return `${GDELT_ENDPOINT}?${params.toString()}`;
}

/** "20261010T071500Z" → ISO timestamp. */
export function gdeltDate(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z` : null;
}

/**
 * Parses an ArtList JSON answer. GDELT answers query problems with a plain-text sentence (still
 * HTTP 200), and an empty result with `{}`. Each article must have url, title and seendate.
 */
export function parseGdelt(body: string, topic?: string): ParsedItem[] {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new ContractError(`GDELT did not answer with JSON: "${cleanText(body).slice(0, 160)}"`);
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new ContractError('GDELT answered with an unexpected format');
  const articles = (data as { articles?: unknown }).articles;
  if (articles === undefined) return [];
  if (!Array.isArray(articles)) throw new ContractError('GDELT "articles" is not a list');
  return articles.map((a: Record<string, unknown>) => {
    const publisher = typeof a.domain === 'string' && a.domain ? a.domain.replace(/^www\./, '') : undefined;
    return {
      url: typeof a.url === 'string' ? a.url : '',
      headline: typeof a.title === 'string' ? cleanText(a.title) : '',
      excerpt: publisher ? `Article on ${publisher}, found by the GDELT news search.` : 'Found by the GDELT news search.',
      publishedAt: gdeltDate(a.seendate),
      eventDate: null,
      eventEndDate: null,
      publisher,
      ...(topic ? { queryTopic: topic } : {}),
    };
  });
}

// ---- Google News RSS search ------------------------------------------------------------------

export function googleNewsUrl(q: TopicQuery, signalKeywords: readonly string[], maxAgeDays: number): string {
  const query = `${orGroup(q.keywords)} ${orGroup(signalKeywords)} when:${maxAgeDays}d`;
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=de&gl=DE&ceid=DE:de`;
}

export function googleNewsCompanyUrl(name: string, maxAgeDays: number): string {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(`"${name}" when:${maxAgeDays}d`)}&hl=de&gl=DE&ceid=DE:de`;
}

/**
 * Google News article links (news.google.com/rss/articles/CBMi…) are redirects. Older ones carry
 * the publisher URL inside the base64 id and can be decoded locally; newer ones cannot without
 * another request, so those keep the Google link (it still opens the article in the browser).
 */
export function decodeGoogleNewsLink(link: string): string {
  const m = /news\.google\.com\/(?:rss\/)?articles\/([A-Za-z0-9_-]+)/.exec(link);
  if (!m) return link;
  try {
    const bytes = base64ToLatin1(m[1]);
    const found = /https?:\/\/[\x21-\x7e]+/.exec(bytes)?.[0];
    if (!found) return link;
    // The URL is followed by protobuf bytes; cut at the first character that cannot be in a URL.
    const clean = found.replace(/[^\w\-.~:/?#[\]@!$&'()*+,;=%].*$/, '');
    new URL(clean);
    return clean;
  } catch {
    return link;
  }
}

/** Google News RSS: `title` is "Headline - Publisher" and `<source>` names the publisher. */
export function parseGoogleNews(xml: string, topic?: string): ParsedItem[] {
  const $ = cheerio.load(xml, { xml: true });
  if ($('rss').length === 0 && $('feed').length === 0) throw new ContractError('Google News did not answer with an RSS feed');
  const items: ParsedItem[] = [];
  $('item').each((_, el) => {
    const node = $(el);
    const publisher = cleanText(node.children('source').first().text());
    let headline = htmlToText(node.children('title').first().text());
    if (publisher && headline.endsWith(` - ${publisher}`)) headline = headline.slice(0, -(publisher.length + 3)).trim();
    const link = cleanText(node.children('link').first().text());
    items.push({
      url: link ? decodeGoogleNewsLink(link) : '',
      headline,
      excerpt: publisher ? `Article on ${publisher}, found by Google News search.` : 'Found by Google News search.',
      publishedAt: toIsoTimestamp(node.children('pubDate').first().text()),
      eventDate: null,
      eventEndDate: null,
      publisher: publisher || undefined,
      ...(topic ? { queryTopic: topic } : {}),
    });
  });
  return items;
}
