// Local state files in Electron's userData folder (or a sub-folder for mock mode).
// Each file is versioned plain JSON; anything that does not look right is treated as corrupt.

import { join } from 'node:path';
import { isDomainId, type CvProfile, type Theme } from '../../shared/types.js';
import type { RawItem } from '../news/types.js';
import { JsonStore } from './jsonStore.js';

export interface SourceCache {
  fetchedAt: number | null;
  items: RawItem[];
  lastError: string | null;
  lastErrorAt: number | null;
}

export interface FeedCache {
  version: 1;
  lastUpdated: number | null;
  sources: Record<string, SourceCache>;
}

export interface ProfileState {
  version: 1;
  profile: CvProfile | null;
  /** Last CV problem (no file, several files, unreadable), shown again after a restart. */
  lastProblem: string | null;
}

export interface Interactions {
  version: 1;
  /** company key → time of first visit */
  visited: Record<string, number>;
  /** news id → time first opened */
  seen: Record<string, number>;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface UiState {
  version: 1;
  theme: Theme;
  bounds: Bounds | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNumOrNull = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v));

function sanitizeNumberMap(v: unknown): Record<string, number> | null {
  if (!isObj(v)) return null;
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(v)) if (typeof n === 'number' && Number.isFinite(n)) out[k] = n;
  return out;
}

function isRawItem(v: unknown): v is RawItem {
  return (
    isObj(v) &&
    typeof v.url === 'string' &&
    typeof v.headline === 'string' &&
    typeof v.excerpt === 'string' &&
    typeof v.sourceId === 'string' &&
    typeof v.sourceName === 'string' &&
    typeof v.topic === 'string' &&
    typeof v.firstSeen === 'number' &&
    (v.publishedAt === null || typeof v.publishedAt === 'string') &&
    (v.eventDate === null || typeof v.eventDate === 'string') &&
    (v.eventEndDate === null || typeof v.eventEndDate === 'string')
  );
}

export function sanitizeFeedCache(v: unknown): FeedCache | null {
  if (!isObj(v) || v.version !== 1 || !isNumOrNull(v.lastUpdated) || !isObj(v.sources)) return null;
  const sources: Record<string, SourceCache> = {};
  for (const [id, s] of Object.entries(v.sources)) {
    if (!isObj(s) || !Array.isArray(s.items)) return null;
    sources[id] = {
      fetchedAt: typeof s.fetchedAt === 'number' ? s.fetchedAt : null,
      items: s.items.filter(isRawItem),
      lastError: typeof s.lastError === 'string' ? s.lastError : null,
      lastErrorAt: typeof s.lastErrorAt === 'number' ? s.lastErrorAt : null,
    };
  }
  return { version: 1, lastUpdated: v.lastUpdated as number | null, sources };
}

export function sanitizeProfileState(v: unknown): ProfileState | null {
  if (!isObj(v) || v.version !== 1) return null;
  const p = v.profile;
  let profile: CvProfile | null = null;
  if (p !== null) {
    if (!isObj(p) || typeof p.fileName !== 'string' || typeof p.modifiedMs !== 'number' || !Array.isArray(p.weights)) return null;
    const weights = p.weights.filter((w): w is { domain: never; weight: number } => isObj(w) && isDomainId(w.domain) && typeof w.weight === 'number');
    profile = { fileName: p.fileName, modifiedMs: p.modifiedMs, weights, computedAt: typeof p.computedAt === 'number' ? p.computedAt : 0 };
  }
  return { version: 1, profile, lastProblem: typeof v.lastProblem === 'string' ? v.lastProblem : null };
}

export function sanitizeInteractions(v: unknown): Interactions | null {
  if (!isObj(v) || v.version !== 1) return null;
  const visited = sanitizeNumberMap(v.visited);
  const seen = sanitizeNumberMap(v.seen);
  return visited && seen ? { version: 1, visited, seen } : null;
}

export function sanitizeUiState(v: unknown): UiState | null {
  if (!isObj(v) || v.version !== 1) return null;
  const theme: Theme = v.theme === 'dark' ? 'dark' : 'day';
  const b = v.bounds;
  const bounds =
    isObj(b) && [b.x, b.y, b.width, b.height].every((n) => typeof n === 'number' && Number.isFinite(n))
      ? { x: b.x as number, y: b.y as number, width: b.width as number, height: b.height as number }
      : null;
  return { version: 1, theme, bounds };
}

export class AppStores {
  readonly feed: JsonStore<FeedCache>;
  readonly profile: JsonStore<ProfileState>;
  readonly interactions: JsonStore<Interactions>;
  readonly ui: JsonStore<UiState>;

  constructor(readonly dir: string) {
    this.feed = new JsonStore(join(dir, 'feed-cache.json'), () => ({ version: 1, lastUpdated: null, sources: {} }), sanitizeFeedCache);
    this.profile = new JsonStore(join(dir, 'profile.json'), () => ({ version: 1, profile: null, lastProblem: null }), sanitizeProfileState);
    this.interactions = new JsonStore(join(dir, 'interactions.json'), () => ({ version: 1, visited: {}, seen: {} }), sanitizeInteractions);
    this.ui = new JsonStore(join(dir, 'ui.json'), () => ({ version: 1, theme: 'day', bounds: null }), sanitizeUiState);
  }

  get httpCacheDir(): string {
    return join(this.dir, 'http-cache');
  }

  /** Files that were corrupt at start-up and moved aside. */
  recoveredFiles(): string[] {
    return [this.feed, this.profile, this.interactions, this.ui].flatMap((s) => (s.recoveredFrom ? [s.recoveredFrom] : []));
  }
}
