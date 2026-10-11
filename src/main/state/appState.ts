// Local state files in Electron's userData folder (or a sub-folder for mock mode).
// Each file is versioned plain JSON; anything that does not look right is treated as corrupt.

import { join } from 'node:path';
import { NEWS_TAGS, isDomainId, type CvProfile, type NewsCard, type Theme, type WindowMode } from '../../shared/types.js';
import type { RawItem } from '../news/types.js';
import { JsonStore } from './jsonStore.js';

export interface SourceCache {
  fetchedAt: number | null;
  items: RawItem[];
  lastError: string | null;
  lastErrorAt: number | null;
  /** Search providers only: the query the cached items answer, so a new domain mix asks again. */
  query?: string;
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
  /** Thumbs down: canonical URL → time removed. Never shown again. */
  removed: Record<string, number>;
  /** Thumbs up: news id → the full card as it was, so it survives Refresh and expiry. */
  useful: Record<string, UsefulEntry>;
}

export type UsefulEntry = Omit<NewsCard, 'seenAt' | 'useful' | 'translated'> & { translated?: NewsCard['translated']; markedAt: number };

export interface ButtonPosition {
  x: number;
  y: number;
  /** Electron display id the button was on, to notice when that screen is gone. */
  displayId: number | null;
}

export interface UiState {
  version: 2;
  theme: Theme;
  mode: WindowMode;
  button: ButtonPosition | null;
  /** "Start with Windows" was switched on once by default (installed app only). */
  autostartDefaultApplied: boolean;
}

export interface ProviderHealthRecord {
  status: 'ok' | 'empty' | 'failed';
  checkedAt: number;
  itemCount: number;
  lastError: string | null;
  /** Failed Refreshes in a row; three or more means "needs attention". */
  consecutiveFailures: number;
}

export interface HealthState {
  version: 1;
  providers: Record<string, ProviderHealthRecord>;
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

/** Drops a damaged translation (it is simply made again on the next Refresh). */
function cleanTranslation(item: RawItem): RawItem {
  const t = item.translation as unknown;
  if (t === undefined) return item;
  const ok = isObj(t) && (t.headline === null || typeof t.headline === 'string') && (t.excerpt === null || typeof t.excerpt === 'string');
  if (ok) return item;
  const { translation: _dropped, ...rest } = item;
  return rest;
}

export function sanitizeFeedCache(v: unknown): FeedCache | null {
  if (!isObj(v) || v.version !== 1 || !isNumOrNull(v.lastUpdated) || !isObj(v.sources)) return null;
  const sources: Record<string, SourceCache> = {};
  for (const [id, s] of Object.entries(v.sources)) {
    if (!isObj(s) || !Array.isArray(s.items)) return null;
    sources[id] = {
      fetchedAt: typeof s.fetchedAt === 'number' ? s.fetchedAt : null,
      items: s.items.filter(isRawItem).map(cleanTranslation),
      lastError: typeof s.lastError === 'string' ? s.lastError : null,
      lastErrorAt: typeof s.lastErrorAt === 'number' ? s.lastErrorAt : null,
      ...(typeof s.query === 'string' ? { query: s.query } : {}),
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

const isStrOrNull = (v: unknown) => v === null || typeof v === 'string';

function isUsefulEntry(v: unknown): v is UsefulEntry {
  return (
    isObj(v) &&
    ['id', 'headline', 'summary', 'url', 'sourceName', 'domainLabel', 'date'].every((k) => typeof v[k] === 'string') &&
    (NEWS_TAGS as readonly unknown[]).includes(v.tag) &&
    (v.domain === 'all' || isDomainId(v.domain)) &&
    isStrOrNull(v.eventDate) &&
    isStrOrNull(v.eventEndDate) &&
    typeof v.markedAt === 'number'
  );
}

export function sanitizeInteractions(v: unknown): Interactions | null {
  if (!isObj(v) || v.version !== 1) return null;
  const visited = sanitizeNumberMap(v.visited);
  const seen = sanitizeNumberMap(v.seen);
  // `removed` and `useful` were added later; older files simply do not have them yet.
  const removed = v.removed === undefined ? {} : sanitizeNumberMap(v.removed);
  if (!visited || !seen || !removed) return null;
  if (v.useful !== undefined && !isObj(v.useful)) return null;
  const useful: Record<string, UsefulEntry> = {};
  for (const [id, entry] of Object.entries((v.useful as Record<string, unknown>) ?? {})) {
    if (isUsefulEntry(entry)) useful[id] = entry;
  }
  return { version: 1, visited, seen, removed, useful };
}

export function sanitizeUiState(v: unknown): UiState | null {
  if (!isObj(v) || (v.version !== 1 && v.version !== 2)) return null;
  const theme: Theme = v.theme === 'dark' ? 'dark' : 'day';
  // Version 1 (a resizable panel with saved bounds) becomes version 2: start as the button.
  if (v.version === 1) return { version: 2, theme, mode: 'collapsed', button: null, autostartDefaultApplied: false };
  const mode: WindowMode = v.mode === 'expanded' ? 'expanded' : 'collapsed';
  const b = v.button;
  const button =
    isObj(b) && typeof b.x === 'number' && Number.isFinite(b.x) && typeof b.y === 'number' && Number.isFinite(b.y)
      ? { x: b.x, y: b.y, displayId: typeof b.displayId === 'number' ? b.displayId : null }
      : null;
  return { version: 2, theme, mode, button, autostartDefaultApplied: v.autostartDefaultApplied === true };
}

export function sanitizeHealth(v: unknown): HealthState | null {
  if (!isObj(v) || v.version !== 1 || !isObj(v.providers)) return null;
  const providers: Record<string, ProviderHealthRecord> = {};
  for (const [id, r] of Object.entries(v.providers)) {
    if (!isObj(r) || !['ok', 'empty', 'failed'].includes(r.status as string) || typeof r.checkedAt !== 'number') continue;
    providers[id] = {
      status: r.status as ProviderHealthRecord['status'],
      checkedAt: r.checkedAt,
      itemCount: typeof r.itemCount === 'number' ? r.itemCount : 0,
      lastError: typeof r.lastError === 'string' ? r.lastError : null,
      consecutiveFailures: typeof r.consecutiveFailures === 'number' ? r.consecutiveFailures : 0,
    };
  }
  return { version: 1, providers };
}

export class AppStores {
  readonly feed: JsonStore<FeedCache>;
  readonly profile: JsonStore<ProfileState>;
  readonly interactions: JsonStore<Interactions>;
  readonly ui: JsonStore<UiState>;
  readonly health: JsonStore<HealthState>;

  constructor(readonly dir: string) {
    this.feed = new JsonStore(join(dir, 'feed-cache.json'), () => ({ version: 1, lastUpdated: null, sources: {} }), sanitizeFeedCache);
    this.profile = new JsonStore(join(dir, 'profile.json'), () => ({ version: 1, profile: null, lastProblem: null }), sanitizeProfileState);
    this.interactions = new JsonStore(join(dir, 'interactions.json'), () => ({ version: 1, visited: {}, seen: {}, removed: {}, useful: {} }), sanitizeInteractions);
    this.ui = new JsonStore(join(dir, 'ui.json'), () => ({ version: 2, theme: 'day', mode: 'collapsed', button: null, autostartDefaultApplied: false }), sanitizeUiState);
    this.health = new JsonStore(join(dir, 'health.json'), () => ({ version: 1, providers: {} }), sanitizeHealth);
  }

  get httpCacheDir(): string {
    return join(this.dir, 'http-cache');
  }

  /** Files that were corrupt at start-up and moved aside. */
  recoveredFiles(): string[] {
    return [this.feed, this.profile, this.interactions, this.ui, this.health].flatMap((s) => (s.recoveredFrom ? [s.recoveredFrom] : []));
  }
}
