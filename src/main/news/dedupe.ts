// Deduplication by canonical URL and by near-identical headlines.

import { createHash } from 'node:crypto';
import { foldText } from '../text/keywords.js';

const TRACKING_PARAMS = /^(utm_[a-z]+|fbclid|gclid|mc_cid|mc_eid|wt_mc|wt_zmc|at_medium|at_campaign)$/i;

/** Lower-case host, https, no www., no fragment, no tracking parameters, no trailing slash. */
export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    u.protocol = 'https:';
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    u.hash = '';
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
    }
    u.searchParams.sort();
    let s = u.toString();
    if (s.endsWith('/') && u.pathname !== '/') s = s.slice(0, -1);
    return s;
  } catch {
    return url.trim();
  }
}

/** Stable id for an item, used for "seen" state. */
export function itemId(url: string): string {
  return createHash('sha1').update(canonicalUrl(url)).digest('hex').slice(0, 16);
}

export function headlineTokens(headline: string): Set<string> {
  return new Set(
    foldText(headline)
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .split(' ')
      .filter((t) => t.length > 1),
  );
}

/** Same words, or word sets overlapping by at least 80 % (Jaccard) for headlines of 4+ words. */
export function isNearDuplicateHeadline(a: string, b: string): boolean {
  const ta = headlineTokens(a);
  const tb = headlineTokens(b);
  if (ta.size === 0 || tb.size === 0) return false;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  const union = ta.size + tb.size - shared;
  if (shared === union) return true;
  return Math.min(ta.size, tb.size) >= 4 && shared / union >= 0.8;
}

/** Keeps the first occurrence; pass items in priority order (e.g. newest first). */
export function dedupe<T extends { url: string; headline: string }>(items: readonly T[]): T[] {
  const urls = new Set<string>();
  const kept: T[] = [];
  for (const item of items) {
    const key = canonicalUrl(item.url);
    if (urls.has(key)) continue;
    if (kept.some((k) => isNearDuplicateHeadline(k.headline, item.headline))) continue;
    urls.add(key);
    kept.push(item);
  }
  return kept;
}
