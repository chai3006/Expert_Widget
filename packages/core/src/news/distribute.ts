// Chooses which classified items to show, in proportion to the CV domain weights.
//
// Per filter group (hiring signals, funded startups, career fairs), at most `maxPerGroup` items:
// - Items whose domain is in the mix get slots proportional to the domain weights. A domain with
//   fewer items than its slots leaves them to other domains in the mix; nothing outside the mix
//   is used to pad.
// - Hiring signals: general items (domain `all`) fill any slots still free.
// - Funded startups: general items are shown only when no item matches the mix.
// - Career fairs: domain-matched and general fairs, taken from each source in turn, soonest first.
// - Without a profile (no CV yet), the newest items are shown regardless of domain.

import type { DomainId, DomainWeight, ItemDomain, NewsTag } from '../shared/types.js';

export interface Selectable {
  tag: NewsTag;
  domain: ItemDomain;
  /** Epoch ms used for "newest first". */
  date: number;
  /** Career fairs: yyyy-mm-dd or null. */
  eventDate: string | null;
  /** Used to share fair slots fairly between sources. */
  sourceId?: string;
}

type Group = 'hiring' | 'funded' | 'fair';

function groupOf(tag: NewsTag): Group {
  if (tag === 'career_fair') return 'fair';
  if (tag === 'funded_startup') return 'funded';
  return 'hiring';
}

const newestFirst = (a: Selectable, b: Selectable) => b.date - a.date;
const soonestFirst = (a: Selectable, b: Selectable) => {
  if (a.eventDate && b.eventDate) return a.eventDate.localeCompare(b.eventDate);
  if (a.eventDate) return -1; // "date to be confirmed" goes last
  if (b.eventDate) return 1;
  return b.date - a.date;
};

/** Whole-number slots per domain summing to `total` (largest remainder; ties in weight order). */
export function allocateSlots(weights: readonly DomainWeight[], total: number): Map<DomainId, number> {
  const sum = weights.reduce((a, w) => a + w.weight, 0);
  const slots = new Map<DomainId, number>();
  if (sum <= 0 || total <= 0) return slots;
  const exact = weights.map((w, i) => ({ domain: w.domain, i, exact: (w.weight / sum) * total }));
  for (const e of exact) slots.set(e.domain, Math.floor(e.exact));
  let left = total - [...slots.values()].reduce((a, b) => a + b, 0);
  const order = [...exact].sort((a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)) || a.i - b.i);
  for (const e of order) {
    if (left <= 0) break;
    slots.set(e.domain, (slots.get(e.domain) ?? 0) + 1);
    left--;
  }
  return slots;
}

function pickProportional<T extends Selectable>(items: T[], weights: readonly DomainWeight[], max: number): T[] {
  const byDomain = new Map<DomainId, T[]>();
  for (const w of weights) byDomain.set(w.domain, []);
  for (const item of [...items].sort(newestFirst)) {
    if (item.domain !== 'all') byDomain.get(item.domain)?.push(item);
  }
  const slots = allocateSlots(weights, max);
  const picked: T[] = [];
  const rest: T[] = [];
  for (const w of weights) {
    const list = byDomain.get(w.domain) ?? [];
    const n = slots.get(w.domain) ?? 0;
    picked.push(...list.slice(0, n));
    rest.push(...list.slice(n));
  }
  // Slots a thin domain could not use go to the other domains in the mix, newest first.
  picked.push(...rest.sort(newestFirst).slice(0, Math.max(0, max - picked.length)));
  return picked;
}

export function selectForProfile<T extends Selectable>(items: readonly T[], weights: readonly DomainWeight[], maxPerGroup: number): T[] {
  const groups: Record<Group, T[]> = { hiring: [], funded: [], fair: [] };
  for (const item of items) groups[groupOf(item.tag)].push(item);

  if (weights.length === 0) {
    return [
      ...groups.hiring.sort(newestFirst).slice(0, maxPerGroup),
      ...groups.funded.sort(newestFirst).slice(0, maxPerGroup),
      ...groups.fair.sort(soonestFirst).slice(0, maxPerGroup),
    ];
  }

  const inMix = new Set<ItemDomain>(weights.map((w) => w.domain));
  const general = (list: T[]) => list.filter((i) => i.domain === 'all').sort(newestFirst);

  const hiring = pickProportional(groups.hiring, weights, maxPerGroup);
  hiring.push(...general(groups.hiring).slice(0, maxPerGroup - hiring.length));

  let funded = pickProportional(groups.funded, weights, maxPerGroup);
  if (funded.length === 0) funded = general(groups.funded).slice(0, maxPerGroup);

  const fairs = pickFairs(groups.fair.filter((i) => i.domain === 'all' || inMix.has(i.domain)), maxPerGroup);

  return [...hiring, ...funded, ...fairs];
}

/**
 * Takes fairs from each source in turn (each source soonest first), so a large general listing
 * cannot crowd out a small engineering-specific one, then orders the result by date.
 */
function pickFairs<T extends Selectable>(fairs: T[], max: number): T[] {
  const bySource = new Map<string, T[]>();
  for (const f of [...fairs].sort(soonestFirst)) {
    const key = f.sourceId ?? '';
    bySource.set(key, [...(bySource.get(key) ?? []), f]);
  }
  const queues = [...bySource.values()];
  const picked: T[] = [];
  while (picked.length < max && queues.some((q) => q.length > 0)) {
    for (const q of queues) {
      const next = q.shift();
      if (next && picked.length < max) picked.push(next);
    }
  }
  return picked.sort(soonestFirst);
}
