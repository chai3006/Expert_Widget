import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateWatchlist, type WatchlistEntry } from '../packages/core/src/config.js';
import { gdeltCompanyUrl } from '../packages/core/src/news/adapters/search.js';
import { itemId } from '../packages/core/src/news/dedupe.js';
import type { Fetcher as PoliteFetcher } from '../packages/core/src/ports.js';
import type { NewsProvider, ProviderQuery } from '../packages/core/src/news/provider.js';
import type { ParsedItem } from '../packages/core/src/news/types.js';
import { WatchlistMatcher, isCompanyEvent } from '../packages/core/src/news/watchlist.js';
import { GdeltProvider } from '../packages/core/src/news/providers.js';
import { SEARCH_MIN_GAP_MS, capItems, runRefresh, type CvProvider } from '../packages/core/src/refresh.js';
import { FileStores as AppStores } from '../packages/node/src/state/fileStores.js';
import { buildView } from '../packages/core/src/view.js';
import { watchlistKey } from '../packages/core/src/shared/ordering.js';
import { defaultConfig, defaultWatchlist } from './helpers/config.js';

const config = defaultConfig();
const watchlist = defaultWatchlist();
const names = watchlist.map((w) => w.name);

describe('watchlist.json', () => {
  it('ships CELUS, Valispace and Hefex Labs, the last one without a website', () => {
    expect(watchlist.map((w) => [w.name, w.website])).toEqual([
      ['CELUS', 'https://www.celus.io/about'],
      ['Valispace', 'https://www.valispace.com'],
      ['Hefex Labs', ''],
    ]);
  });

  it('accepts an empty website and optional fields, and reports every problem with its path', () => {
    const ok = validateWatchlist({ companies: [{ name: ' Acme ', website: '' }] });
    expect(ok).toEqual({ ok: true, value: [{ name: 'Acme', website: '', note: '', addedAt: '', lastVerified: '' }] });

    const bad = validateWatchlist({
      companies: [{ name: 'Acme', website: 'ftp://acme.example' }, { name: 'acme' }, { name: '' }, { name: 'B', addedAt: '11.10.2026' }, 'C'],
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors).toEqual([
        'watchlist.json companies[0].website: must be empty or an http or https URL',
        'watchlist.json companies[1].name: "acme" is listed twice',
        'watchlist.json companies[2].name: must be a non-empty string',
        'watchlist.json companies[3].addedAt: must be empty or a date like 2026-10-11',
        'watchlist.json companies[4]: must be an object',
      ]);
    }
    expect(validateWatchlist([]).ok).toBe(false);
  });
});

describe('matching', () => {
  const matcher = new WatchlistMatcher(names);
  const m = (headline: string, excerpt = '') => matcher.match({ headline, excerpt });

  it('finds the exact name as a whole word, in the headline or the summary, in any case', () => {
    expect(m('CELUS sammelt 25 Millionen Euro ein')).toEqual(['CELUS']);
    expect(m('Münchner Startup Celus wächst')).toEqual(['CELUS']);
    expect(m('Neue Plattform', 'Die CELUS-Plattform automatisiert Schaltpläne.')).toEqual(['CELUS']);
    expect(m('Hefex Labs eröffnet Labor')).toEqual(['Hefex Labs']);
    expect(m('Hefex  Labs eröffnet Labor')).toEqual(['Hefex Labs']);
    expect(m("Valispace's new release, with CELUS as partner")).toEqual(['CELUS', 'Valispace']);
  });

  it('ignores look-alikes and partial names', () => {
    expect(m('Celusion GmbH schafft neue Stellen')).toEqual([]);
    expect(m('Marcelus Bau expandiert')).toEqual([]);
    expect(m('Valispaces und andere Tools')).toEqual([]);
    expect(m('Hefex eröffnet Standort')).toEqual([]);
    expect(m('Hefex Laboratories eröffnet Standort')).toEqual([]);
    expect(m('HefexLabs eröffnet Standort')).toEqual([]);
  });

  it('recognises company events', () => {
    expect(isCompanyEvent({ headline: 'Webinar: Valispace zeigt Requirements Engineering', excerpt: '' })).toBe(true);
    expect(isCompanyEvent({ headline: 'CELUS auf der Fachmesse electronica', excerpt: '' })).toBe(true);
    expect(isCompanyEvent({ headline: 'CELUS sammelt 25 Millionen Euro ein', excerpt: '' })).toBe(false);
  });
});

// ---- Feed, ordering and visited state ------------------------------------------------------

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'expert-watchlist-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const t0 = new Date(2026, 9, 11, 8, 0).getTime();
const HOUR = 3600 * 1000;

const automotiveOnly: CvProvider = {
  readProfile: async () => ({ ok: true, profile: { fileName: 'cv.pdf', modifiedMs: 1, computedAt: 1, weights: [{ domain: 'automotive-emobility', weight: 100 }] } }),
};
const noCv: CvProvider = { readProfile: async () => ({ ok: false, problem: 'No CV found.' }) };

const news = (n: number, headline: string, extra: Partial<ParsedItem> = {}): ParsedItem => ({
  url: `https://example.de/news/${n}`,
  headline,
  excerpt: '',
  publishedAt: new Date(t0 - n * HOUR).toISOString(),
  eventDate: null,
  eventEndDate: null,
  ...extra,
});

function provider(id: string, layer: 1 | 2 | 3, topic: NewsProvider['topic'], items: ParsedItem[], calls: ProviderQuery[] = []): NewsProvider {
  return {
    id,
    name: id,
    layer,
    topic,
    domains: 'all',
    fetch: async (q) => {
      calls.push(q);
      return items;
    },
  };
}

const FEED = [
  news(1, 'Autobauer schafft 300 neue Arbeitsplätze in Sachsen'),
  news(2, 'CELUS schafft 40 neue Stellen in München'),
  // Medtech is not in the CV mix, but a watchlist company is shown anyway.
  news(3, 'Medizintechnik: Valispace expandiert in die Medizintechnik und schafft neue Stellen'),
  news(4, 'Celusion GmbH schafft neue Stellen'),
  news(5, 'Webinar mit Valispace: Requirements Engineering für Hardware-Teams'),
];
const FAIRS = [news(6, 'Startup-Karrieretag München mit CELUS', { publishedAt: null, eventDate: '2026-10-20', eventEndDate: '2026-10-20' })];
const SEARCH = [news(7, 'Hefex Labs sammelt 5 Millionen Euro Seed-Finanzierung ein', { queryCompany: 'Hefex Labs' })];

async function refreshAll(stores: AppStores, list: readonly WatchlistEntry[] = watchlist) {
  await runRefresh({
    config,
    cvFolder: dir,
    stores,
    cv: automotiveOnly,
    providers: [provider('ingenieur-wirtschaft', 1, 'hiring', FEED), provider('messen-karrieremessen', 1, 'career_fair', FAIRS), provider('gdelt', 2, 'hiring', SEARCH)],
    watchlist: list.map((w) => w.name),
    isOnline: () => true,
    now: () => t0,
    mock: false,
  });
  return (entries: readonly WatchlistEntry[] = list) =>
    buildView({ mock: false, config, employers: [], watchlist: [...entries], configError: null, stores, cvFolder: dir, messages: [], refreshing: false, now: t0 });
}

describe('watchlist in the news feed', () => {
  it('labels matching cards, shows them first and outside the domain mix', async () => {
    const view = (await refreshAll(new AppStores(dir)))();
    const headlines = view.news.map((n) => [n.headline, n.tag, n.watchlist]);
    expect(headlines).toEqual([
      ['CELUS schafft 40 neue Stellen in München', 'hiring_growth', ['CELUS']],
      ['Medizintechnik: Valispace expandiert in die Medizintechnik und schafft neue Stellen', 'hiring_growth', ['Valispace']],
      ['Hefex Labs sammelt 5 Millionen Euro Seed-Finanzierung ein', 'funded_startup', ['Hefex Labs']],
      ['Startup-Karrieretag München mit CELUS', 'career_fair', ['CELUS']],
      ['Webinar mit Valispace: Requirements Engineering für Hardware-Teams', 'career_fair', ['Valispace']],
      ['Autobauer schafft 300 neue Arbeitsplätze in Sachsen', 'hiring_growth', []],
      ['Celusion GmbH schafft neue Stellen', 'hiring_growth', []],
    ]);
  });

  it('shows a company event with its date, or "date to be confirmed"', async () => {
    const view = (await refreshAll(new AppStores(dir)))();
    const fair = view.news.find((n) => n.headline.startsWith('Startup-Karrieretag'));
    const webinar = view.news.find((n) => n.headline.startsWith('Webinar'));
    expect([fair?.eventDate, webinar?.eventDate]).toEqual(['2026-10-20', null]);
  });

  it('counts new cards per company, and the count drops once a card is seen', async () => {
    const stores = new AppStores(dir);
    const view = await refreshAll(stores);
    expect(view().watchlist.map((c) => [c.name, c.newsCount])).toEqual([['CELUS', 2], ['Valispace', 2], ['Hefex Labs', 1]]);
    stores.interactions.update((s) => ({ ...s, seen: { [itemId('https://example.de/news/2')]: t0 } }));
    expect(view().watchlist.find((c) => c.name === 'CELUS')?.newsCount).toBe(1);
  });

  it('follows edits to watchlist.json without a new search', async () => {
    const stores = new AppStores(dir);
    const view = await refreshAll(stores);
    const withoutCelus = watchlist.filter((w) => w.name !== 'CELUS');
    const after = view(withoutCelus);
    expect(after.watchlist.map((c) => c.name)).toEqual(['Valispace', 'Hefex Labs']);
    expect(after.news.find((n) => n.headline.startsWith('CELUS'))?.watchlist).toEqual([]);
  });
});

describe('watchlist chips', () => {
  it('has no link until a website is filled in', async () => {
    const view = (await refreshAll(new AppStores(dir)))();
    expect(view.watchlist.map((c) => c.website)).toEqual(['https://www.celus.io/about', 'https://www.valispace.com', null]);
  });

  it('moves a visited company to the end, apart from an employer of the same name', async () => {
    const stores = new AppStores(dir);
    const view = await refreshAll(stores);
    stores.interactions.update((s) => ({ ...s, visited: { [watchlistKey('CELUS')]: t0, celus: t0 } }));
    const chips = view().watchlist;
    expect(chips.map((c) => [c.name, c.visitedAt])).toEqual([['Valispace', null], ['Hefex Labs', null], ['CELUS', t0]]);

    stores.interactions.update((s) => ({ ...s, visited: { celus: t0 } }));
    expect(view().watchlist[0]).toMatchObject({ name: 'CELUS', visitedAt: null });
  });
});

// ---- Searching by company name -------------------------------------------------------------

describe('company search', () => {
  it('asks GDELT for the company name alone and keeps only exact-name articles', async () => {
    const urls: string[] = [];
    const body = JSON.stringify({
      articles: [
        { url: 'https://example.com/a', title: 'CELUS raises EUR 25 million', seendate: '20261010T081500Z', domain: 'example.com' },
        { url: 'https://example.com/b', title: 'Celusion launches new product', seendate: '20261010T081500Z', domain: 'example.com' },
      ],
    });
    const fetcher = { getText: async (u: string) => (urls.push(u), body) } as unknown as PoliteFetcher;
    const items = await new GdeltProvider(fetcher, 75).fetch({ domains: [], companies: ['CELUS'], signalKeywords: ['hiring'], maxAgeDays: 7 });
    expect(items.map((i) => [i.headline, i.queryCompany, i.queryDomain])).toEqual([['CELUS raises EUR 25 million', 'CELUS', undefined]]);
    expect(urls).toEqual([gdeltCompanyUrl('CELUS', 7, 75)]);
    expect(new URL(urls[0]).searchParams.get('query')).toBe('"CELUS"');
  });

  it('searches the watchlist even without a CV, and again at once when the watchlist changes', async () => {
    const stores = new AppStores(dir);
    const calls: ProviderQuery[] = [];
    const gdelt = provider('gdelt', 2, 'hiring', [], calls);
    const run = (list: string[], at: number) =>
      runRefresh({ config, cvFolder: dir, stores, cv: noCv, providers: [gdelt], watchlist: list, isOnline: () => true, now: () => at, mock: false });

    await run(names, t0);
    await run(names, t0 + 60_000);
    await run([...names, 'Isar Aerospace'], t0 + 120_000);
    await run([...names, 'Isar Aerospace'], t0 + SEARCH_MIN_GAP_MS);
    expect(calls.map((q) => [q.domains.length, q.companies])).toEqual([
      [0, ['CELUS', 'Valispace', 'Hefex Labs']],
      [0, ['CELUS', 'Valispace', 'Hefex Labs', 'Isar Aerospace']],
    ]);
  });

  it('keeps company results apart from the cap on domain results', () => {
    const domainItems = Array.from({ length: 200 }, (_, i) => news(i, `Neue Stellen ${i}`));
    const companyItems = Array.from({ length: 60 }, (_, i) => news(1000 + i, `CELUS ${i}`, { queryCompany: 'CELUS' }));
    const capped = capItems([...domainItems, ...companyItems], 2);
    expect(capped.filter((i) => !i.queryCompany)).toHaveLength(150);
    expect(capped.filter((i) => i.queryCompany === 'CELUS')).toHaveLength(50);
  });
});
