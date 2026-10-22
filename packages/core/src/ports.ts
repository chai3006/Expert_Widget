// Everything the core needs from the outside world, as interfaces. The core never reads files or
// the network itself: the Node package (packages/node), the desktop app or a dashboard backend
// passes in implementations of these.

/** Current time in epoch milliseconds. Injected so tests and replays can fix the clock. */
export type Clock = () => number;

/** One piece of persisted state (a JSON document). Implementations: JSON file, memory, a database row. */
export interface StateStore<T> {
  readonly value: T;
  set(value: T): void;
  update(change: (current: T) => T): void;
}

/** A cached HTTP response, kept to revalidate with ETag / Last-Modified. */
export interface CachedResponse {
  url: string;
  /** URL after redirects. Missing in entries written before it was recorded. */
  finalUrl?: string;
  etag: string | null;
  lastModified: string | null;
  fetchedAt: number;
  body: string;
}

/** A cached robots.txt. `body` null: the site has none (everything allowed). */
export interface CachedRobots {
  fetchedAt: number;
  body: string | null;
}

/** Storage for the polite fetcher's response and robots.txt caches. */
export interface HttpCache {
  getResponse(url: string): CachedResponse | null;
  setResponse(url: string, entry: CachedResponse): void;
  getRobots(origin: string): CachedRobots | null;
  setRobots(origin: string, entry: CachedRobots): void;
}

/** Fetches public pages and feeds. The Node implementation obeys robots.txt, spaces requests and caches. */
export interface Fetcher {
  getText(url: string): Promise<string>;
}

export type FetchErrorKind = 'offline' | 'timeout' | 'http' | 'robots' | 'too-large' | 'other';

export class FetchError extends Error {
  override name = 'FetchError';
  constructor(
    readonly kind: FetchErrorKind,
    message: string,
  ) {
    super(message);
  }
}

/** The CV as read on the user's computer. `text` stays in memory and is never stored or sent. */
export interface CvDocument {
  fileName: string;
  modifiedMs: number;
  sizeBytes: number;
  text: string;
}

/** Why the CV could not be read; each has its own plain message with the next step. */
export type CvProblemKind =
  | 'no-file'
  | 'multiple'
  | 'unsupported'
  | 'password'
  | 'scanned'
  | 'empty'
  | 'too-large'
  | 'locked'
  | 'no-permission'
  | 'unreadable';

export type CvReadResult = { ok: true; document: CvDocument } | { ok: false; problem: string; kind?: CvProblemKind };

/** Where the CV comes from: a folder on this computer, or text handed over by a local caller. */
export interface CvSource {
  read(): Promise<CvReadResult>;
}

/** German → English translation that runs on the user's computer. */
export interface Translator {
  /** Translates German texts to English, same order. */
  translate(texts: string[]): Promise<string[]>;
  close(): Promise<void>;
}

/** A state store kept in memory only (tests, the CLI with --no-state). */
export class MemoryStore<T> implements StateStore<T> {
  constructor(private current: T) {}

  get value(): T {
    return this.current;
  }

  set(value: T): void {
    this.current = value;
  }

  update(change: (current: T) => T): void {
    this.current = change(this.current);
  }
}

/** An HTTP cache kept in memory only. */
export class MemoryHttpCache implements HttpCache {
  private readonly responses = new Map<string, CachedResponse>();
  private readonly robots = new Map<string, CachedRobots>();

  getResponse(url: string): CachedResponse | null {
    return this.responses.get(url) ?? null;
  }

  setResponse(url: string, entry: CachedResponse): void {
    this.responses.set(url, entry);
  }

  getRobots(origin: string): CachedRobots | null {
    return this.robots.get(origin) ?? null;
  }

  setRobots(origin: string, entry: CachedRobots): void {
    this.robots.set(origin, entry);
  }
}
