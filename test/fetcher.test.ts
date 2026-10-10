import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FetchError, PoliteFetcher, classifyNetworkError, type FetchLike } from '../src/main/news/fetcher.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'expert-fetch-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

interface Call {
  url: string;
  headers: Record<string, string>;
  at: number;
}

function fakeServer(routes: Record<string, (headers: Record<string, string>) => Response>) {
  const calls: Call[] = [];
  let clock = 1_000_000;
  const fetchImpl: FetchLike = async (url, init) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, headers, at: clock });
    const route = routes[url];
    return route ? route(headers) : new Response('not found', { status: 404 });
  };
  return {
    calls,
    fetchImpl,
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms;
    },
  };
}

const UA = 'ExpertWidget/test';

describe('polite fetcher', () => {
  it('sends the User-Agent, checks robots.txt once per host and spaces requests', async () => {
    const server = fakeServer({
      'https://news.example/robots.txt': () => new Response('User-agent: *\nDisallow: /private/'),
      'https://news.example/a': () => new Response('A'),
      'https://news.example/b': () => new Response('B'),
    });
    const fetcher = new PoliteFetcher({ userAgent: UA, cacheDir: dir, fetchImpl: server.fetchImpl, now: server.now, sleep: server.sleep, minIntervalMs: 2000 });
    expect(await Promise.all([fetcher.getText('https://news.example/a'), fetcher.getText('https://news.example/b')])).toEqual(['A', 'B']);
    expect(server.calls.map((c) => c.url)).toEqual(['https://news.example/robots.txt', 'https://news.example/a', 'https://news.example/b']);
    expect(server.calls.every((c) => c.headers['User-Agent'] === UA)).toBe(true);
    const gaps = server.calls.slice(1).map((c, i) => c.at - server.calls[i].at);
    expect(gaps.every((g) => g >= 2000)).toBe(true);
  });

  it('refuses pages that robots.txt disallows', async () => {
    const server = fakeServer({
      'https://news.example/robots.txt': () => new Response('User-agent: *\nDisallow: /private/'),
      'https://news.example/private/x': () => new Response('secret'),
    });
    const fetcher = new PoliteFetcher({ userAgent: UA, cacheDir: dir, fetchImpl: server.fetchImpl, now: server.now, sleep: server.sleep });
    await expect(fetcher.getText('https://news.example/private/x')).rejects.toMatchObject({ kind: 'robots' });
    expect(server.calls.map((c) => c.url)).not.toContain('https://news.example/private/x');
  });

  it('treats a missing robots.txt as allowed', async () => {
    const server = fakeServer({ 'https://news.example/a': () => new Response('A') });
    const fetcher = new PoliteFetcher({ userAgent: UA, cacheDir: dir, fetchImpl: server.fetchImpl, now: server.now, sleep: server.sleep });
    expect(await fetcher.getText('https://news.example/a')).toBe('A');
  });

  it('revalidates with ETag and serves the cached body on 304', async () => {
    const server = fakeServer({
      'https://news.example/robots.txt': () => new Response('', { status: 404 }),
      'https://news.example/feed': (h) => (h['If-None-Match'] === '"v1"' ? new Response(null, { status: 304 }) : new Response('<rss/>', { headers: { ETag: '"v1"' } })),
    });
    const make = () => new PoliteFetcher({ userAgent: UA, cacheDir: dir, fetchImpl: server.fetchImpl, now: server.now, sleep: server.sleep });
    expect(await make().getText('https://news.example/feed')).toBe('<rss/>');
    expect(await make().getText('https://news.example/feed')).toBe('<rss/>');
    expect(server.calls.filter((c) => c.url.endsWith('/feed')).at(-1)?.headers['If-None-Match']).toBe('"v1"');
  });

  it('reports HTTP errors and decodes ISO-8859-1 pages', async () => {
    const server = fakeServer({
      'https://news.example/gone': () => new Response('x', { status: 410 }),
      'https://news.example/latin': () => new Response(new Uint8Array([0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72]), { headers: { 'Content-Type': 'text/html; charset=ISO-8859-1' } }),
    });
    const fetcher = new PoliteFetcher({ userAgent: UA, cacheDir: dir, fetchImpl: server.fetchImpl, now: server.now, sleep: server.sleep });
    await expect(fetcher.getText('https://news.example/gone')).rejects.toMatchObject({ kind: 'http', message: 'the server answered HTTP 410' });
    expect(await fetcher.getText('https://news.example/latin')).toBe('Müller');
  });

  it('classifies network failures as offline or timeout', () => {
    expect(classifyNetworkError(new Error('net::ERR_INTERNET_DISCONNECTED')).kind).toBe('offline');
    expect(classifyNetworkError(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })).kind).toBe('offline');
    expect(classifyNetworkError(Object.assign(new Error('aborted'), { name: 'TimeoutError' })).kind).toBe('timeout');
    expect(classifyNetworkError(new FetchError('robots', 'x')).kind).toBe('robots');
  });
});
