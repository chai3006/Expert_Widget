// Polite HTTP fetching for news sources:
// - identifies itself with a clear User-Agent,
// - obeys robots.txt (cached per host for a day),
// - serialises requests per host with a minimum gap between them,
// - caches responses and revalidates with ETag / Last-Modified.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import robotsParser from 'robots-parser';
import { writeJsonAtomic } from '../state/jsonStore.js';

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

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface FetcherOptions {
  userAgent: string;
  cacheDir: string;
  fetchImpl: FetchLike;
  minIntervalMs?: number;
  timeoutMs?: number;
  maxBytes?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

interface CachedResponse {
  url: string;
  etag: string | null;
  lastModified: string | null;
  fetchedAt: number;
  body: string;
}

interface CachedRobots {
  fetchedAt: number;
  /** null: no robots.txt (everything allowed). */
  body: string | null;
}

const ROBOTS_TTL_MS = 24 * 60 * 60 * 1000;
const NETWORK_CODES = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ENETUNREACH|EHOSTUNREACH|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_NETWORK_CHANGED|ERR_CONNECTION|ERR_ADDRESS_UNREACHABLE|ERR_PROXY/;

export function classifyNetworkError(err: unknown): FetchError {
  if (err instanceof FetchError) return err;
  const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  const text = `${e?.name ?? ''} ${e?.message ?? ''} ${e?.cause?.code ?? ''} ${e?.cause?.message ?? ''}`;
  if (/TimeoutError|AbortError|ETIMEDOUT|ERR_TIMED_OUT/.test(text)) return new FetchError('timeout', 'the request timed out');
  if (NETWORK_CODES.test(text)) return new FetchError('offline', 'no network connection');
  return new FetchError('other', e?.message ?? String(err));
}

function hash(s: string): string {
  return createHash('sha1').update(s).digest('hex');
}

export class PoliteFetcher {
  private readonly hostChains = new Map<string, Promise<unknown>>();
  private readonly lastRequestAt = new Map<string, number>();
  private readonly robotsMemo = new Map<string, CachedRobots>();
  private readonly minIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: FetcherOptions) {
    this.minIntervalMs = opts.minIntervalMs ?? 2000;
    this.timeoutMs = opts.timeoutMs ?? 20000;
    this.maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Fetches a page as text. Requests to the same host run one after another. */
  getText(url: string): Promise<string> {
    const host = new URL(url).host;
    const previous = this.hostChains.get(host) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(() => this.fetchAllowed(url));
    this.hostChains.set(host, run);
    return run;
  }

  private async fetchAllowed(url: string): Promise<string> {
    const robots = await this.robotsFor(url);
    if (robots !== null) {
      const parser = robotsParser(new URL('/robots.txt', url).toString(), robots);
      if (parser.isAllowed(url, this.opts.userAgent) === false) {
        throw new FetchError('robots', 'robots.txt does not allow fetching this page');
      }
    }
    return this.fetchWithCache(url);
  }

  private async robotsFor(url: string): Promise<string | null> {
    const origin = new URL(url).origin;
    const file = join(this.opts.cacheDir, 'robots', `${hash(origin)}.json`);
    let cached = this.robotsMemo.get(origin);
    if (!cached && existsSync(file)) {
      try {
        cached = JSON.parse(readFileSync(file, 'utf8')) as CachedRobots;
      } catch {
        cached = undefined;
      }
    }
    if (cached && this.now() - cached.fetchedAt < ROBOTS_TTL_MS) return cached.body;

    let body: string | null;
    try {
      const res = await this.request(`${origin}/robots.txt`, {});
      if (res.status >= 500) throw new FetchError('http', `robots.txt answered HTTP ${res.status}`);
      body = res.ok ? await this.readBody(res) : null;
    } catch (err) {
      // Keep using an older copy if the server is briefly unreachable.
      if (cached) return cached.body;
      throw classifyNetworkError(err);
    }
    const entry = { fetchedAt: this.now(), body };
    this.robotsMemo.set(origin, entry);
    writeJsonAtomic(file, entry);
    return body;
  }

  private async fetchWithCache(url: string): Promise<string> {
    const file = join(this.opts.cacheDir, 'http', `${hash(url)}.json`);
    let cached: CachedResponse | null = null;
    if (existsSync(file)) {
      try {
        cached = JSON.parse(readFileSync(file, 'utf8')) as CachedResponse;
      } catch {
        cached = null;
      }
    }
    const headers: Record<string, string> = {};
    if (cached?.etag) headers['If-None-Match'] = cached.etag;
    if (cached?.lastModified) headers['If-Modified-Since'] = cached.lastModified;

    let res: Response;
    try {
      res = await this.request(url, headers);
    } catch (err) {
      throw classifyNetworkError(err);
    }
    if (res.status === 304 && cached) return cached.body;
    if (!res.ok) throw new FetchError('http', `the server answered HTTP ${res.status}`);

    const body = await this.readBody(res);
    writeJsonAtomic(file, {
      url,
      etag: res.headers.get('etag'),
      lastModified: res.headers.get('last-modified'),
      fetchedAt: this.now(),
      body,
    } satisfies CachedResponse);
    return body;
  }

  private async request(url: string, headers: Record<string, string>): Promise<Response> {
    const host = new URL(url).host;
    const wait = (this.lastRequestAt.get(host) ?? 0) + this.minIntervalMs - this.now();
    if (wait > 0) await this.sleep(wait);
    this.lastRequestAt.set(host, this.now());
    return this.opts.fetchImpl(url, {
      headers: {
        'User-Agent': this.opts.userAgent,
        Accept: 'text/html,application/rss+xml,application/atom+xml,application/xml;q=0.9,*/*;q=0.5',
        'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
        ...headers,
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }

  private async readBody(res: Response): Promise<string> {
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength > this.maxBytes) throw new FetchError('too-large', 'the page is unexpectedly large');
    const charset = /charset=([^;]+)/i.exec(res.headers.get('content-type') ?? '')?.[1]?.trim().toLowerCase();
    const label = charset === 'iso-8859-1' || charset === 'latin1' ? 'windows-1252' : charset || 'utf-8';
    try {
      return new TextDecoder(label).decode(buffer);
    } catch {
      return new TextDecoder('utf-8').decode(buffer);
    }
  }
}
