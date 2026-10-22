// Ordering rules for visited companies and seen news. Used by the main process when building
// the view and by the renderer when it reorders immediately after a click.

import type { CompanyChip, NewsCard } from './types.js';

export function companyKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Visited-state key of a watchlist company, separate from the same name under Employers. */
export function watchlistKey(name: string): string {
  return `watchlist:${companyKey(name)}`;
}

/** Unvisited companies keep their order; visited ones follow, earliest visit first. */
export function orderCompanies<T extends Pick<CompanyChip, 'visitedAt'>>(companies: readonly T[]): T[] {
  const unvisited = companies.filter((c) => c.visitedAt === null);
  const visited = companies
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.visitedAt !== null)
    .sort((a, b) => (a.c.visitedAt as number) - (b.c.visitedAt as number) || a.i - b.i)
    .map(({ c }) => c);
  return [...unvisited, ...visited];
}

/** Unseen cards keep their order and come first; seen cards sink to the bottom, earliest seen first. */
export function orderNews<T extends Pick<NewsCard, 'seenAt'>>(cards: readonly T[]): T[] {
  const unseen = cards.filter((c) => c.seenAt === null);
  const seen = cards
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.seenAt !== null)
    .sort((a, b) => (a.c.seenAt as number) - (b.c.seenAt as number) || a.i - b.i)
    .map(({ c }) => c);
  return [...unseen, ...seen];
}
