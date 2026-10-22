import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateConfig, validateEmployers, validateWatchlist, type AppConfig, type EmployerSegment, type WatchlistEntry } from '../../packages/core/src/config.js';
import type { DomainRegistry } from '../../packages/core/src/domains.js';
import type { AppData } from '../../packages/core/src/newsData.js';
import { loadAppData } from '../../packages/node/src/appData.js';

export const ROOT = join(__dirname, '..', '..');
export const FIXTURES = join(ROOT, 'test', 'fixtures');

export function defaultConfigJson(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(ROOT, 'defaults', 'config.json'), 'utf8'));
}

let cachedData: AppData | null = null;

/** Everything in data/: domain registry, news rules and source registry. */
export function appData(): AppData {
  if (!cachedData) {
    const result = loadAppData(join(ROOT, 'data'));
    if (!result.ok) throw new Error(result.errors.join(' | '));
    cachedData = result.value;
  }
  return cachedData;
}

/** The domain registry from data/domains. */
export function registry(): DomainRegistry {
  return appData().domains;
}

export function defaultConfig(): AppConfig {
  const result = validateConfig(defaultConfigJson(), appData());
  if (!result.ok) throw new Error(result.errors.join('\n'));
  return result.value;
}

export function defaultEmployers(): EmployerSegment[] {
  const result = validateEmployers(JSON.parse(readFileSync(join(ROOT, 'defaults', 'employers.json'), 'utf8')), registry());
  if (!result.ok) throw new Error(result.errors.join('\n'));
  return result.value;
}

export function defaultWatchlist(): WatchlistEntry[] {
  const result = validateWatchlist(JSON.parse(readFileSync(join(ROOT, 'defaults', 'watchlist.json'), 'utf8')));
  if (!result.ok) throw new Error(result.errors.join('\n'));
  return result.value;
}

export function fixture(...parts: string[]): string {
  return readFileSync(join(FIXTURES, ...parts), 'utf8');
}
