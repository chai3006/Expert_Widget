import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { enabledProviders, type ProviderInfo } from '../packages/core/src/config.js';
import { MockCvProvider, mockProviders } from '../packages/core/src/mock/mockData.js';
import { FetchError } from '../packages/core/src/ports.js';
import type { NewsProvider } from '../packages/core/src/news/provider.js';
import type { ParsedItem } from '../packages/core/src/news/types.js';
import { runRefresh, type CvProvider } from '../packages/core/src/refresh.js';
import { FileStores as AppStores } from '../packages/node/src/state/fileStores.js';
import { writeJsonAtomic } from '../packages/node/src/state/jsonStore.js';
import { buildView } from '../packages/core/src/view.js';
import { defaultConfig, defaultEmployers, defaultWatchlist } from './helpers/config.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'expert-state-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('JSON state files', () => {
  it('writes atomically and leaves no temp files', () => {
    const path = join(dir, 'a.json');
    writeJsonAtomic(path, { a: 1 });
    writeJsonAtomic(path, { a: 2 });
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ a: 2 });
    expect(readdirSync(dir)).toEqual(['a.json']);
  });

  it('backs up a corrupt file and starts fresh', () => {
    writeFileSync(join(dir, 'interactions.json'), '{"version":1,"visited":{"bosch":1');
    writeFileSync(join(dir, 'ui.json'), JSON.stringify({ version: 1, theme: 'dark', bounds: null }));
    const stores = new AppStores(dir);
    expect(stores.interactions.value).toEqual({ version: 1, visited: {}, seen: {}, removed: {}, useful: {} });
    expect(stores.ui.value.theme).toBe('dark');
    expect(stores.recoveredFiles()).toHaveLength(1);
    expect(readdirSync(dir).some((f) => /^interactions\.corrupt-.*\.json$/.test(f))).toBe(true);
  });

  it('treats a wrong shape as corrupt too', () => {
    writeFileSync(join(dir, 'feed-cache.json'), JSON.stringify({ version: 1, lastUpdated: 'yesterday', sources: {} }));
    const stores = new AppStores(dir);
    expect(stores.feed.value.lastUpdated).toBeNull();
    expect(stores.recoveredFiles()).toHaveLength(1);
  });

  it('visited and seen survive a restart', () => {
    const first = new AppStores(dir);
    first.interactions.update((s) => ({ ...s, visited: { bosch: 5 }, seen: { abc: 6 } }));
    first.ui.update((u) => ({ ...u, theme: 'dark' }));
    const second = new AppStores(dir);
    expect(second.interactions.value.visited).toEqual({ bosch: 5 });
    expect(second.interactions.value.seen).toEqual({ abc: 6 });
    expect(second.ui.value.theme).toBe('dark');
  });
});

const config = defaultConfig();
const okProfile: CvProvider = {
  readProfile: async () => ({ ok: true, profile: { fileName: 'cv.pdf', modifiedMs: 1, computedAt: 1, weights: [{ domain: 'automotive-emobility', weight: 100 }] } }),
};
const failingCv = (problem: string): CvProvider => ({ readProfile: async () => ({ ok: false, problem }) });

/** Fake providers mirroring the enabled ones in the default config (feeds and GDELT). */
function news(handler: (s: ProviderInfo) => ParsedItem[] | Error, online = true): { providers: NewsProvider[]; isOnline: () => boolean } {
  return {
    isOnline: () => online,
    providers: enabledProviders(config).map((info) => ({
      ...info,
      fetch: async () => {
        const r = handler(info);
        if (r instanceof Error) throw r;
        return r;
      },
    })),
  };
}

const headline = (s: ProviderInfo): ParsedItem => ({
  url: `https://example.com/${s.id}/1`,
  headline: s.topic === 'career_fair' ? `Karrieremesse ${s.id}` : `Autobauer Stellenabbau ${s.id}`,
  excerpt: '',
  publishedAt: s.topic === 'career_fair' ? null : '2026-10-09T10:00:00.000Z',
  eventDate: null,
  eventEndDate: null,
});

describe('refresh', () => {
  const t0 = new Date(2026, 9, 9, 19, 40).getTime();
  const t1 = new Date(2026, 9, 10, 7, 12).getTime();

  it('updates profile, caches and Last updated', async () => {
    const stores = new AppStores(dir);
    const messages = await runRefresh({ config, cvFolder: dir, stores, cv: okProfile, ...news((s) => [headline(s)]), now: () => t0, mock: false });
    expect(messages).toEqual([]);
    expect(stores.feed.value.lastUpdated).toBe(t0);
    expect(stores.profile.value.profile?.fileName).toBe('cv.pdf');
    expect(Object.keys(stores.feed.value.sources)).toHaveLength(enabledProviders(config).length);
  });

  it('when offline keeps cached data and says from when', async () => {
    const stores = new AppStores(dir);
    await runRefresh({ config, cvFolder: dir, stores, cv: okProfile, ...news((s) => [headline(s)]), now: () => t0, mock: false });
    const before = JSON.stringify(stores.feed.value);
    const messages = await runRefresh({ config, cvFolder: dir, stores, cv: okProfile, ...news((s) => [headline(s)], false), now: () => t1, mock: false });
    expect(messages).toEqual([{ level: 'warning', text: 'Offline, showing data from yesterday, 19:40' }]);
    expect(JSON.stringify(stores.feed.value)).toBe(before);
  });

  it('treats every source failing with network errors as offline', async () => {
    const stores = new AppStores(dir);
    await runRefresh({ config, cvFolder: dir, stores, cv: okProfile, ...news((s) => [headline(s)]), now: () => t0, mock: false });
    const messages = await runRefresh({ config, cvFolder: dir, stores, cv: okProfile, ...news(() => new FetchError('offline', 'no network connection')), now: () => t1, mock: false });
    expect(messages[0].text).toBe('Offline, showing data from yesterday, 19:40');
    expect(stores.feed.value.lastUpdated).toBe(t0);
    expect(stores.feed.value.sources.startbase.items).toHaveLength(1);
  });

  it('one failing source keeps its old items and does not break the others', async () => {
    const stores = new AppStores(dir);
    await runRefresh({ config, cvFolder: dir, stores, cv: okProfile, ...news((s) => [headline(s)]), now: () => t0, mock: false });
    const messages = await runRefresh({
      config,
      cvFolder: dir,
      stores,
      cv: okProfile,
      ...news((s) => (s.id === 'startbase' ? new FetchError('http', 'the server answered HTTP 503') : [{ ...headline(s), url: `https://example.com/${s.id}/2` }])),
      now: () => t1,
      mock: false,
    });
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toContain('Startbase (the server answered HTTP 503)');
    expect(stores.feed.value.lastUpdated).toBe(t1);
    expect(stores.feed.value.sources.startbase.items[0].url).toBe('https://example.com/startbase/1');
    expect(stores.feed.value.sources['eurofound-erm'].items[0].url).toBe('https://example.com/eurofound-erm/2');
  });

  it('keeps the previous domain mix when the CV cannot be read, and says why', async () => {
    const stores = new AppStores(dir);
    await runRefresh({ config, cvFolder: dir, stores, cv: okProfile, ...news((s) => [headline(s)]), now: () => t0, mock: false });
    await runRefresh({ config, cvFolder: dir, stores, cv: failingCv('Could not read cv.pdf: the file is locked by another program.'), ...news((s) => [headline(s)]), now: () => t1, mock: false });
    expect(stores.profile.value.profile?.weights).toEqual([{ domain: 'automotive-emobility', weight: 100 }]);
    expect(stores.profile.value.lastProblem).toBe('Could not read cv.pdf: the file is locked by another program. Keeping the domain mix from cv.pdf.');
  });

  it('keeps first-seen times across refreshes', async () => {
    const stores = new AppStores(dir);
    await runRefresh({ config, cvFolder: dir, stores, cv: okProfile, ...news((s) => [headline(s)]), now: () => t0, mock: false });
    await runRefresh({ config, cvFolder: dir, stores, cv: okProfile, ...news((s) => [headline(s)]), now: () => t1, mock: false });
    expect(stores.feed.value.sources.startbase.items[0].firstSeen).toBe(t0);
  });
});

describe('mock data', () => {
  it('fills the whole UI, and mock items never show in a normal run', async () => {
    const stores = new AppStores(dir);
    const now = Date.now();
    const watchlist = defaultWatchlist();
    await runRefresh({ config, cvFolder: dir, stores, cv: new MockCvProvider(), providers: mockProviders(config), watchlist: watchlist.map((w) => w.name), isOnline: () => true, now: () => now, mock: true });
    const input = { config, employers: defaultEmployers(), watchlist, configError: null, stores, cvFolder: dir, messages: [], refreshing: false, now };
    const mockView = buildView({ ...input, mock: true });
    expect(mockView.data.profile?.weights).toHaveLength(4);
    expect(mockView.data.employers[0].segments.length).toBeGreaterThan(0);
    const tags = new Set(mockView.data.news.map((n) => n.tag));
    expect([...tags].sort()).toEqual(['career_fair', 'funded_startup', 'hiring_cuts', 'hiring_growth']);
    expect(mockView.data.news.every((n) => n.headline.startsWith('[MOCK]'))).toBe(true);
    // Every watchlist company has mock news, and those cards come first.
    expect(mockView.data.watchlist.map((c) => [c.name, c.newsCount > 0])).toEqual([['CELUS', true], ['Valispace', true], ['Hefex Labs', true]]);
    expect(mockView.data.news[0].watchlist.length).toBeGreaterThan(0);

    const normalView = buildView({ ...input, mock: false });
    expect(normalView.data.news).toEqual([]);
  });
});

describe('view', () => {
  it('shows the empty state before the first refresh and a config error screen', () => {
    const stores = new AppStores(dir);
    const base = { mock: false, config, employers: defaultEmployers(), watchlist: [], configError: null, stores, cvFolder: 'C:\\cv', messages: [], refreshing: false, now: 0 };
    expect(buildView(base).ui.hasData).toBe(false);
    const broken = buildView({ ...base, config: null, configError: 'config.json has problems' });
    expect(broken.ui.configError).toBe('config.json has problems');
    expect(existsSync(join(dir, 'feed-cache.json'))).toBe(false);
  });
});
