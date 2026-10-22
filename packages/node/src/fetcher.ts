// Polite HTTP fetching for news sources:
// - identifies itself with a clear User-Agent,
// - obeys robots.txt (cached per host for a day),
// - serialises requests per host with a minimum gap between them,
// - caches responses and revalidates with ETag / Last-Modified.

import robotsParser from 'robots-parser';
import { FetchError, type CachedResponse, type CachedRobots, type Fetcher, type HttpCache } from '../../core/src/ports.js';
import { DiskHttpCache } from './httpCache.js';

export { FetchError };
export type { FetchErrorKind } from '../../core/src/ports.js';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface FetcherOptions {
  userAgent: string;
  /** Response and robots.txt cache. Either a cache, or a folder for the JSON file cache. */
  cache?: HttpCache;
  cacheDir?: string;
  fetchImpl: FetchLike;
  minIntervalMs?: number;
  /** Longer gaps for hosts that ask for them, e.g. { 'api.gdeltproject.org': 5500 }. */
  hostIntervalsMs?: Record<string, number>;
  timeoutMs?: number;
  maxBytes?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
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

/** A page after redirects: its final address and its text. */
export interface FetchedPage {
  finalUrl: string;
  body: string;
}

export class PoliteFetcher implements Fetcher {
  private readonly hostChains = new Map<string, Promise<unknown>>();
  private readonly lastRequestAt = new Map<string, number>();
  private readonly robotsMemo = new Map<string, CachedRobots>();
  private readonly minIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly cache: HttpCache;

  constructor(private readonly opts: FetcherOptions) {
    if (!opts.cache && !opts.cacheDir) throw new Error('PoliteFetcher needs a cache or a cacheDir');
    this.cache = opts.cache ?? new DiskHttpCache(opts.cacheDir as string);
    this.minIntervalMs = opts.minIntervalMs ?? 2000;
    this.timeoutMs = opts.timeoutMs ?? 20000;
    this.maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Fetches a page as text. Requests to the same host run one after another. */
  async getText(url: string): Promise<string> {
    return (await this.getPage(url)).body;
  }

  /** Like getText, and also says where redirects ended (used to check company career links). */
  getPage(url: string): Promise<FetchedPage> {
    const host = new URL(url).host;
    const previous = this.hostChains.get(host) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(() => this.fetchAllowed(url));
    this.hostChains.set(host, run);
    return run;
  }

  private async fetchAllowed(url: string): Promise<FetchedPage> {
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
    const cached = this.robotsMemo.get(origin) ?? this.cache.getRobots(origin) ?? undefined;
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
    this.cache.setRobots(origin, entry);
    return body;
  }

  private async fetchWithCache(url: string): Promise<FetchedPage> {
    const cached = this.cache.getResponse(url);
    const headers: Record<string, string> = {};
    if (cached?.etag) headers['If-None-Match'] = cached.etag;
    if (cached?.lastModified) headers['If-Modified-Since'] = cached.lastModified;

    let res: Response;
    try {
      res = await this.request(url, headers);
    } catch (err) {
      throw classifyNetworkError(err);
    }
    if (res.status === 304 && cached) return { finalUrl: cached.finalUrl ?? url, body: cached.body };
    if (res.status === 429) throw new FetchError('http', 'the server answered HTTP 429 (too many requests, try again later)');
    if (!res.ok) throw new FetchError('http', `the server answered HTTP ${res.status}`);

    const body = await this.readBody(res);
    // Response.url is empty for responses made up in tests; the request URL stands in.
    const finalUrl = res.url || url;
    this.cache.setResponse(url, {
      url,
      finalUrl,
      etag: res.headers.get('etag'),
      lastModified: res.headers.get('last-modified'),
      fetchedAt: this.now(),
      body,
    } satisfies CachedResponse);
    return { finalUrl, body };
  }

  private async request(url: string, headers: Record<string, string>): Promise<Response> {
    const host = new URL(url).host;
    const interval = Math.max(this.minIntervalMs, this.opts.hostIntervalsMs?.[host] ?? 0);
    const wait = (this.lastRequestAt.get(host) ?? 0) + interval - this.now();
    if (wait > 0) await this.sleep(wait);
    this.lastRequestAt.set(host, this.now());
    return this.opts.fetchImpl(url, {
      headers: {
        'User-Agent': this.opts.userAgent,
        Accept: 'text/html,application/rss+xml,application/atom+xml,application/xml;q=0.9,application/json;q=0.9,*/*;q=0.5',
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
