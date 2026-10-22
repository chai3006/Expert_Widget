// Expiry rules: news older than newsMaxAgeDays is dropped; career fairs are dropped once their
// (last) event day is over, and fairs without a date stay ("date to be confirmed").

import { parseLocalDate } from '../shared/format.js';
import type { NewsTag } from '../shared/types.js';
import type { RawItem } from './types.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Publication time, or first sighting when the source has no date. */
export function effectiveDate(item: Pick<RawItem, 'publishedAt' | 'firstSeen'>): number {
  const t = item.publishedAt ? Date.parse(item.publishedAt) : NaN;
  return Number.isNaN(t) ? item.firstSeen : t;
}

export function isExpired(
  item: Pick<RawItem, 'publishedAt' | 'firstSeen' | 'eventDate' | 'eventEndDate'>,
  tag: NewsTag,
  now: number,
  maxAgeDays: number,
): boolean {
  if (tag === 'career_fair') {
    const last = item.eventEndDate ?? item.eventDate;
    if (!last) return false;
    const day = parseLocalDate(last);
    if (!day) return false;
    const endOfEventDay = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
    return now >= endOfEventDay;
  }
  return now - effectiveDate(item) > maxAgeDays * DAY_MS;
}
