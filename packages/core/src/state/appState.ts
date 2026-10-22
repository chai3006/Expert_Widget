// The persisted state: what each document looks like, how a damaged one is recognised (the
// sanitizers return null), and the set of stores a Refresh works on. Where the documents live is up
// to the caller: JSON files (packages/node), memory (tests, CLI) or a database.

import { MemoryStore, type CvProblemKind, type StateStore } from '../ports.js';
import { NEWS_TAGS, isDomainId, type CvProfile, type DomainEvidenceView, type DomainWeight, type NewsCard, type Theme, type WindowMode } from '../shared/types.js';
import type { RawItem } from '../news/types.js';

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

/** Domains the user chose by hand; they replace the automatic mix until the user goes back. */
export interface ManualDomains {
  weights: DomainWeight[];
  setAt: number;
}

export interface ProfileState {
  version: 1;
  /** The profile computed from the CV (automatic or fallback). */
  profile: CvProfile | null;
  /** Last CV problem (no file, several files, unreadable), shown again after a restart. */
  lastProblem: string | null;
  /** Its kind, so the UI can show the right help (see CvProblemKind). */
  lastProblemKind?: CvProblemKind | null;
  /** Set when the user chose the domains by hand. Missing in files written before that existed. */
  manual?: ManualDomains | null;
}

/**
 * The profile the rest of the app uses: the manual choice when there is one (keeping the CV's
 * evidence for the domains still in it), else the profile computed from the CV.
 */
export function effectiveProfile(state: ProfileState): CvProfile | null {
  const manual = state.manual;
  if (!manual) return state.profile;
  const base = state.profile;
  return {
    fileName: base?.fileName ?? '',
    modifiedMs: base?.modifiedMs ?? 0,
    ...(base?.sizeBytes !== undefined ? { sizeBytes: base.sizeBytes } : {}),
    computedAt: manual.setAt,
    weights: manual.weights,
    source: 'manual',
    evidence: (base?.evidence ?? []).filter((e) => manual.weights.some((w) => w.domain === e.domain)),
    notice: null,
  };
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

export type UsefulEntry = Omit<NewsCard, 'seenAt' | 'useful' | 'translated' | 'watchlist'> & {
  translated?: NewsCard['translated'];
  /** Not used when reading back: the label follows the current watchlist.json. */
  watchlist?: string[];
  markedAt: number;
};

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
  /** Start at login was switched on once by default (installed app only). */
  autostartDefaultApplied: boolean;
  /** A CV folder the user chose with "Choose another folder"; wins over config.json. */
  cvFolder?: string | null;
  /** Searching the news for watchlist company names (the only user-chosen search terms). Missing: on. */
  watchlistSearch?: boolean;
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

function sanitizeWeights(v: unknown): DomainWeight[] {
  return Array.isArray(v) ? v.filter((w): w is DomainWeight => isObj(w) && isDomainId(w.domain) && typeof w.weight === 'number').map((w) => ({ domain: w.domain, weight: w.weight })) : [];
}

const EVIDENCE_KINDS = ['title', 'education', 'certification', 'skill', 'keyword'];
const CV_PROBLEM_KINDS = ['no-file', 'multiple', 'unsupported', 'password', 'scanned', 'empty', 'too-large', 'locked', 'no-permission', 'unreadable'] as const;

function sanitizeEvidence(v: unknown): DomainEvidenceView[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter(
      (e): e is DomainEvidenceView =>
        isObj(e) && isDomainId(e.domain) && typeof e.label === 'string' && EVIDENCE_KINDS.includes(e.kind as string) && (e.period === null || typeof e.period === 'string') && typeof e.current === 'boolean',
    )
    .map((e) => ({ domain: e.domain, label: e.label.slice(0, 80), kind: e.kind, period: e.period?.slice(0, 40) ?? null, current: e.current }));
}

export function sanitizeProfileState(v: unknown): ProfileState | null {
  if (!isObj(v) || v.version !== 1) return null;
  const p = v.profile;
  let profile: CvProfile | null = null;
  if (p !== null) {
    if (!isObj(p) || typeof p.fileName !== 'string' || typeof p.modifiedMs !== 'number' || !Array.isArray(p.weights)) return null;
    profile = {
      fileName: p.fileName,
      modifiedMs: p.modifiedMs,
      ...(typeof p.sizeBytes === 'number' ? { sizeBytes: p.sizeBytes } : {}),
      weights: sanitizeWeights(p.weights),
      computedAt: typeof p.computedAt === 'number' ? p.computedAt : 0,
      // Profiles written before the domain registry have none of these; they count as automatic.
      source: p.source === 'fallback' ? 'fallback' : 'auto',
      evidence: sanitizeEvidence(p.evidence),
      notice: typeof p.notice === 'string' ? p.notice : null,
    };
  }
  const m = v.manual;
  const manual = isObj(m) && typeof m.setAt === 'number' && sanitizeWeights(m.weights).length > 0 ? { weights: sanitizeWeights(m.weights), setAt: m.setAt } : null;
  const kind = typeof v.lastProblemKind === 'string' && (CV_PROBLEM_KINDS as readonly string[]).includes(v.lastProblemKind) ? (v.lastProblemKind as CvProblemKind) : null;
  return { version: 1, profile, lastProblem: typeof v.lastProblem === 'string' ? v.lastProblem : null, lastProblemKind: kind, manual };
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
  return {
    version: 2,
    theme,
    mode,
    button,
    autostartDefaultApplied: v.autostartDefaultApplied === true,
    cvFolder: typeof v.cvFolder === 'string' && v.cvFolder.trim() !== '' ? v.cvFolder : null,
    watchlistSearch: v.watchlistSearch !== false,
  };
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

/** Empty state, as on a first start. */
export const INITIAL_STATE = {
  feed: (): FeedCache => ({ version: 1, lastUpdated: null, sources: {} }),
  profile: (): ProfileState => ({ version: 1, profile: null, lastProblem: null }),
  interactions: (): Interactions => ({ version: 1, visited: {}, seen: {}, removed: {}, useful: {} }),
  ui: (): UiState => ({ version: 2, theme: 'day', mode: 'collapsed', button: null, autostartDefaultApplied: false }),
  health: (): HealthState => ({ version: 1, providers: {} }),
};

export const SANITIZERS = {
  feed: sanitizeFeedCache,
  profile: sanitizeProfileState,
  interactions: sanitizeInteractions,
  ui: sanitizeUiState,
  health: sanitizeHealth,
};

/** All state a Refresh and the view read and write. */
export interface AppStores {
  readonly feed: StateStore<FeedCache>;
  readonly profile: StateStore<ProfileState>;
  readonly interactions: StateStore<Interactions>;
  readonly ui: StateStore<UiState>;
  readonly health: StateStore<HealthState>;
  /** Damaged documents that were set aside at start-up (shown once as a note). */
  recoveredFiles(): string[];
}

/** Stores that live in memory only. */
export function memoryStores(): AppStores {
  return {
    feed: new MemoryStore(INITIAL_STATE.feed()),
    profile: new MemoryStore(INITIAL_STATE.profile()),
    interactions: new MemoryStore(INITIAL_STATE.interactions()),
    ui: new MemoryStore(INITIAL_STATE.ui()),
    health: new MemoryStore(INITIAL_STATE.health()),
    recoveredFiles: () => [],
  };
}
