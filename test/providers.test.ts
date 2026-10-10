import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { enabledProviders, type AdapterId, type SourceTopic } from '../src/main/config.js';
import { ADAPTERS } from '../src/main/news/adapters/index.js';
import {
  buildProviderQuery,
  decodeGoogleNewsLink,
  gdeltDate,
  gdeltUrl,
  googleNewsUrl,
  isSearchableKeyword,
  parseGdelt,
  parseGoogleNews,
} from '../src/main/news/adapters/search.js';
import { checkContract, ContractError, type NewsProvider, type ProviderQuery } from '../src/main/news/provider.js';
import type { ParsedItem } from '../src/main/news/types.js';
import { GdeltProvider, GoogleNewsProvider } from '../src/main/providers.js';
import { runRefresh, uncoveredDomains, type CvProvider } from '../src/main/refresh.js';
import { AppStores } from '../src/main/state/appState.js';
import { buildView } from '../src/main/view.js';
import type { PoliteFetcher } from '../src/main/news/fetcher.js';
import { defaultConfig, defaultEmployers, fixture } from './helpers/config.js';

const config = defaultConfig();

describe('provider contract', () => {
  // Every saved source page must satisfy the contract, otherwise a real Refresh would fail it.
  const pages: Array<[AdapterId, string, string, SourceTopic]> = [
    ['rss', 'ingenieur-wirtschaft.rss.xml', 'https://www.ingenieur.de/wirtschaft/feed/', 'hiring'],
    ['rss', 'startbase.rss.xml', 'https://www.startbase.de/feed/', 'funded_startup'],
    ['rss', 'munich-startup.rss.xml', 'https://www.munich-startup.de/feed/', 'funded_startup'],
    ['ingenieur-recruiting-tag', 'ingenieur-recruiting-tag.html', 'https://www.ingenieur.de/recruiting-tag/', 'career_fair'],
    ['messen-de', 'messen-karrieremessen.html', 'https://www.messen.de/de/1594/branche/karrieremessen', 'career_fair'],
    ['eurofound-erm', 'eurofound-germany.html', 'https://apps.eurofound.europa.eu/restructuring-events/search?Country=Germany', 'hiring'],
    ['produktion-de', 'produktion-wirtschaft.html', 'https://www.produktion.de/wirtschaft/', 'hiring'],
  ];
  it.each(pages)('%s adapter output for %s passes', (adapter, file, url, topic) => {
    const items = ADAPTERS[adapter](fixture('sources', file), url);
    expect(items.length).toBeGreaterThan(0);
    expect(() => checkContract(items, topic)).not.toThrow();
  });

  it('accepts search fixtures', () => {
    expect(() => checkContract(parseGdelt(fixture('sources', 'gdelt-artlist.json'), 'automotive-emobility'), 'hiring')).not.toThrow();
    expect(() => checkContract(parseGoogleNews(fixture('sources', 'google-news.rss.xml'), 'automotive-emobility'), 'hiring')).not.toThrow();
  });

  const good: ParsedItem = { url: 'https://example.com/a', headline: 'Werk schafft Arbeitsplätze', excerpt: '', publishedAt: '2026-10-09T08:00:00.000Z', eventDate: null, eventEndDate: null };

  it('fails loudly on a missing title, link or date', () => {
    expect(() => checkContract([good, { ...good, headline: ' ' }], 'hiring')).toThrow(new ContractError('item 2 has no title'));
    expect(() => checkContract([{ ...good, url: '' }], 'hiring')).toThrow(/item 1 \("Werk schafft Arbeitsplätze"\) has no valid link/);
    expect(() => checkContract([{ ...good, url: 'javascript:alert(1)' }], 'hiring')).toThrow(/no valid link/);
    expect(() => checkContract([{ ...good, publishedAt: null }], 'funded_startup')).toThrow(/has no date/);
    expect(() => checkContract([{ ...good, publishedAt: 'gestern' }], 'hiring')).toThrow(/has no date/);
  });

  it('lets career fairs go without a date ("date to be confirmed") but not with a broken one', () => {
    expect(() => checkContract([{ ...good, publishedAt: null }], 'career_fair')).not.toThrow();
    expect(() => checkContract([{ ...good, publishedAt: null, eventDate: '28.10.2026' }], 'career_fair')).toThrow(/unreadable event date/);
  });

  it('an RSS feed whose entry lost its link fails instead of silently shrinking', () => {
    const xml = '<rss><channel><item><title>Ohne Link</title><pubDate>Fri, 09 Oct 2026 08:00:00 GMT</pubDate></item></channel></rss>';
    expect(() => checkContract(ADAPTERS.rss(xml, 'https://example.com/feed/'), 'hiring')).toThrow(/no valid link/);
  });
});

describe('search queries', () => {
  it('use only config keywords that both services accept', () => {
    expect(isSearchableKeyword('Elektroauto')).toBe(true);
    expect(isSearchableKeyword('neues Werk')).toBe(true);
    expect(isSearchableKeyword('ECU')).toBe(false);
    expect(isSearchableKeyword('C++')).toBe(false);
    const q = buildProviderQuery(config, ['automotive-emobility', 'embedded-iot']);
    expect(q.domains.map((d) => d.domain)).toEqual(['automotive-emobility', 'embedded-iot']);
    expect(q.domains.every((d) => d.keywords.length > 0 && d.keywords.length <= 8 && d.keywords.every(isSearchableKeyword))).toBe(true);
    const allConfigWords = new Set([...Object.values(config.keywords.domains).flat(), ...Object.values(config.keywords.tags).flat()]);
    expect([...q.domains.flatMap((d) => d.keywords), ...q.signalKeywords].every((k) => allConfigWords.has(k))).toBe(true);
    expect(q.maxAgeDays).toBe(7);
  });

  it('builds the GDELT request with country, language, timespan and record limit', () => {
    const url = new URL(gdeltUrl({ domain: 'automotive-emobility', keywords: ['Elektroauto', 'neues Werk'] }, ['Stellenabbau', 'Series A'], 7));
    expect(url.origin + url.pathname).toBe('https://api.gdeltproject.org/api/v2/doc/doc');
    expect(url.searchParams.get('query')).toBe('(Elektroauto OR "neues Werk") (Stellenabbau OR "Series A") sourcecountry:germany sourcelang:german');
    expect(url.searchParams.get('mode')).toBe('artlist');
    expect(url.searchParams.get('format')).toBe('json');
    expect(url.searchParams.get('timespan')).toBe('7d');
    expect(url.searchParams.get('maxrecords')).toBe('75');
  });

  it('builds the Google News request in German for Germany', () => {
    const url = new URL(googleNewsUrl({ domain: 'automotive-emobility', keywords: ['Elektroauto'] }, ['Stellenabbau', 'Jobabbau'], 7));
    expect(url.searchParams.get('q')).toBe('Elektroauto (Stellenabbau OR Jobabbau) when:7d');
    expect(url.searchParams.get('hl')).toBe('de');
    expect(url.searchParams.get('gl')).toBe('DE');
    expect(url.searchParams.get('ceid')).toBe('DE:de');
  });
});

describe('GDELT provider', () => {
  it('parses an ArtList answer', () => {
    const items = parseGdelt(fixture('sources', 'gdelt-artlist.json'), 'automotive-emobility');
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      url: 'https://www.example-news.de/wirtschaft/zulieferer-baut-stellen-ab-100.html',
      headline: 'Zulieferer kündigt Stellenabbau in der Batteriefertigung an',
      publishedAt: '2026-10-09T08:15:00.000Z',
      publisher: 'example-news.de',
      queryDomain: 'automotive-emobility',
    });
    expect(items[1].publisher).toBe('example-zeitung.de');
    expect(gdeltDate('2026-10-09')).toBeNull();
  });

  it('treats an empty result as no items and a text answer as a broken contract', () => {
    expect(parseGdelt('{}', 'automotive-emobility')).toEqual([]);
    expect(() => parseGdelt('Your search contained a keyword that was too short.', 'automotive-emobility')).toThrow(ContractError);
    expect(() => parseGdelt('{"articles": "none"}', 'automotive-emobility')).toThrow(/not a list/);
  });

  it('marks an article without a title as a contract failure', () => {
    const items = parseGdelt('{"articles":[{"url":"https://example.com/x","seendate":"20261009T081500Z","domain":"example.com"}]}', 'automotive-emobility');
    expect(() => checkContract(items, 'hiring')).toThrow(/has no title/);
  });

  it('sends one request per domain, only with config words', async () => {
    const urls: string[] = [];
    const fetcher = { getText: async (u: string) => (urls.push(u), fixture('sources', 'gdelt-artlist.json')) } as unknown as PoliteFetcher;
    const query = buildProviderQuery(config, ['automotive-emobility', 'energy-storage']);
    const items = await new GdeltProvider(fetcher, 75).fetch(query);
    expect(urls).toHaveLength(2);
    expect(items.map((i) => i.queryDomain)).toEqual([...Array(3).fill('automotive-emobility'), ...Array(3).fill('energy-storage')]);
  });
});

describe('Google News provider', () => {
  it('strips the publisher from the title and decodes the publisher link where possible', () => {
    const items = parseGoogleNews(fixture('sources', 'google-news.rss.xml'), 'automotive-emobility');
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      headline: 'Zulieferer streicht 300 Stellen in der Elektroauto-Sparte',
      url: 'https://www.example-kurier.de/wirtschaft/zulieferer-streicht-300',
      publisher: 'Example Kurier',
      publishedAt: '2026-10-09T07:30:00.000Z',
    });
    // Newer ids carry no URL; the Google link is kept.
    expect(items[1].url).toBe('https://news.google.com/rss/articles/CBMiqAFBVV95cUxNcnB0X3h5ejEyMw?oc=5');
    expect(decodeGoogleNewsLink('https://example.com/a')).toBe('https://example.com/a');
  });

  it('rejects an answer that is not a feed', () => {
    expect(() => parseGoogleNews('<html><body>Consent</body></html>', 'automotive-emobility')).toThrow(ContractError);
  });

  it('has its own provider id and layer', () => {
    const p = new GoogleNewsProvider({} as PoliteFetcher);
    expect([p.id, p.layer]).toEqual(['google-news', 3]);
  });
});

// ---- Layers, fallback and source health ----------------------------------------------------

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'expert-providers-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const twoDomains: CvProvider = {
  readProfile: async () => ({
    ok: true,
    profile: { fileName: 'cv.pdf', modifiedMs: 1, computedAt: 1, weights: [{ domain: 'automotive-emobility', weight: 60 }, { domain: 'energy-storage', weight: 40 }] },
  }),
};

const item = (url: string, extra: Partial<ParsedItem> = {}): ParsedItem => ({
  url,
  headline: `Werk schafft Arbeitsplätze ${url}`,
  excerpt: '',
  publishedAt: '2026-10-09T08:00:00.000Z',
  eventDate: null,
  eventEndDate: null,
  ...extra,
});

type Behaviour = (query: ProviderQuery) => ParsedItem[] | Error;

function fake(id: string, layer: 1 | 2 | 3, behaviour: Behaviour, calls: ProviderQuery[] = []): NewsProvider {
  return {
    id,
    name: id,
    layer,
    topic: 'hiring',
    domains: 'all',
    fetch: async (q) => {
      calls.push(q);
      const r = behaviour(q);
      if (r instanceof Error) throw r;
      return r;
    },
  };
}

const t = (day: number) => new Date(2026, 9, day, 8, 0).getTime();

async function refresh(stores: AppStores, providers: NewsProvider[], day = 10) {
  return runRefresh({ config, cvFolder: dir, stores, cv: twoDomains, providers, isOnline: () => true, now: () => t(day), mock: false });
}

describe('layers', () => {
  it('asks Google News only for domains GDELT left empty', async () => {
    const stores = new AppStores(dir);
    const googleCalls: ProviderQuery[] = [];
    await refresh(stores, [
      fake('feed', 1, () => [item('https://example.com/feed/1')]),
      fake('gdelt', 2, () => [item('https://example.com/g/1', { queryDomain: 'automotive-emobility' })]),
      fake('google-news', 3, () => [item('https://example.com/n/1', { queryDomain: 'energy-storage' })], googleCalls),
    ]);
    expect(googleCalls).toHaveLength(1);
    expect(googleCalls[0].domains.map((d) => d.domain)).toEqual(['energy-storage']);
  });

  it('asks Google News for every domain when GDELT fails, and not at all when GDELT covers everything', async () => {
    const stores = new AppStores(dir);
    const calls: ProviderQuery[] = [];
    await refresh(stores, [fake('gdelt', 2, () => new Error('the server answered HTTP 429')), fake('google-news', 3, () => [], calls)]);
    expect(calls[0].domains.map((d) => d.domain)).toEqual(['automotive-emobility', 'energy-storage']);

    const none: ProviderQuery[] = [];
    await refresh(stores, [
      fake('gdelt', 2, () => [item('https://example.com/a', { queryDomain: 'automotive-emobility' }), item('https://example.com/b', { queryDomain: 'energy-storage' })]),
      fake('google-news', 3, () => [], none),
    ]);
    expect(none).toHaveLength(0);
  });

  it('does not search without a domain mix', async () => {
    const stores = new AppStores(dir);
    const calls: ProviderQuery[] = [];
    await runRefresh({
      config,
      cvFolder: dir,
      stores,
      cv: { readProfile: async () => ({ ok: false, problem: 'No CV found.' }) },
      providers: [fake('gdelt', 2, () => [], calls)],
      isOnline: () => true,
      now: () => t(10),
      mock: false,
    });
    expect(calls).toHaveLength(0);
  });

  it('uncoveredDomains lists domains without search results', () => {
    const q = buildProviderQuery(config, ['automotive-emobility', 'energy-storage']);
    const gdelt = fake('gdelt', 2, () => []);
    expect(uncoveredDomains(q, [])).toEqual(['automotive-emobility', 'energy-storage']);
    expect(uncoveredDomains(q, [{ provider: gdelt, items: [item('https://x.de/1', { queryDomain: 'energy-storage' })] }])).toEqual(['automotive-emobility']);
    expect(uncoveredDomains(q, [{ provider: gdelt, error: new Error('x') }])).toEqual(['automotive-emobility', 'energy-storage']);
  });

  it('keeps the feed copy of an article that GDELT also found', async () => {
    const stores = new AppStores(dir);
    const url = 'https://www.example.com/wirtschaft/werk';
    await refresh(stores, [
      { ...fake('feed', 1, () => [item(url, { headline: 'Autobauer: neues Werk schafft Arbeitsplätze' })]), name: 'Feed' },
      { ...fake('gdelt', 2, () => [item(`${url}?utm_source=gdelt`, { headline: 'Autobauer: neues Werk schafft Arbeitsplätze', publisher: 'example.com', queryDomain: 'automotive-emobility' })]), name: 'GDELT' },
    ]);
    // Build the view against the default config's provider list, using the fake ids' caches.
    stores.feed.update((f) => ({ ...f, sources: { 'ingenieur-wirtschaft': f.sources.feed, gdelt: f.sources.gdelt } }));
    const v = buildView({ mock: false, config, employers: defaultEmployers(), configError: null, stores, cvFolder: dir, messages: [], refreshing: false, now: t(10) });
    const matching = v.news.filter((n) => n.headline === 'Autobauer: neues Werk schafft Arbeitsplätze');
    expect(matching).toHaveLength(1);
    expect(matching[0].sourceName).toBe('Feed');
  });
});

describe('source health', () => {
  it('records ok, empty and failed per provider and never lets one failure break the others', async () => {
    const stores = new AppStores(dir);
    const messages = await refresh(stores, [
      fake('a', 1, () => [item('https://example.com/a')]),
      fake('b', 1, () => []),
      fake('c', 1, () => new Error('the server answered HTTP 503')),
      fake('d', 1, () => [item('https://example.com/d', { publishedAt: null })]),
    ]);
    const h = stores.health.value.providers;
    expect(h.a).toMatchObject({ status: 'ok', itemCount: 1, consecutiveFailures: 0 });
    expect(h.b).toMatchObject({ status: 'empty', itemCount: 0 });
    expect(h.c).toMatchObject({ status: 'failed', lastError: 'the server answered HTTP 503', consecutiveFailures: 1 });
    // Malformed data: failed for this Refresh, no crash, nothing from it cached.
    expect(h.d).toMatchObject({ status: 'failed', consecutiveFailures: 1 });
    expect(h.d.lastError).toMatch(/has no date/);
    expect(stores.feed.value.sources.d?.items ?? []).toEqual([]);
    expect(stores.feed.value.sources.a.items).toHaveLength(1);
    expect(messages[0].text).toMatch(/^2 sources could not be loaded: c \(the server answered HTTP 503\), d \(item 1/);
  });

  it('flags a provider that failed three Refreshes in a row, and clears it on success', async () => {
    const stores = new AppStores(dir);
    const failing = [fake('ingenieur-wirtschaft', 1, () => new Error('the page layout may have changed'))];
    const view = () => buildView({ mock: false, config, employers: [], configError: null, stores, cvFolder: dir, messages: [], refreshing: false, now: t(12) });
    await refresh(stores, failing, 10);
    await refresh(stores, failing, 11);
    expect(view().sourceHealth.providers.find((p) => p.id === 'ingenieur-wirtschaft')?.needsAttention).toBe(false);
    await refresh(stores, failing, 12);
    const p = view().sourceHealth.providers.find((x) => x.id === 'ingenieur-wirtschaft');
    expect(p).toMatchObject({ status: 'failed', needsAttention: true, detail: 'the page layout may have changed' });
    await refresh(stores, [fake('ingenieur-wirtschaft', 1, () => [item('https://example.com/ok')])], 13);
    expect(view().sourceHealth.providers.find((x) => x.id === 'ingenieur-wirtschaft')).toMatchObject({ status: 'ok', needsAttention: false });
  });

  it('summarises as "N of M working", counting only providers that have run', async () => {
    const stores = new AppStores(dir);
    const ids = enabledProviders(config).map((p) => p.id);
    await refresh(
      stores,
      ids.map((id, i) => fake(id, id === 'gdelt' ? 2 : 1, () => (i === 0 ? new Error('HTTP 500') : [item(`https://example.com/${id}`, { queryDomain: 'automotive-emobility' })]))),
    );
    const v = buildView({ mock: false, config, employers: [], configError: null, stores, cvFolder: dir, messages: [], refreshing: false, now: t(10) });
    expect(v.sourceHealth.total).toBe(ids.length);
    expect(v.sourceHealth.working).toBe(ids.length - 1);
    expect(v.sourceHealth.providers.map((p) => p.id)).toEqual(ids);
  });

  it('shows providers that have not run yet as unchecked', () => {
    const stores = new AppStores(dir);
    const v = buildView({ mock: false, config, employers: [], configError: null, stores, cvFolder: dir, messages: [], refreshing: false, now: t(10) });
    expect(v.sourceHealth.total).toBe(0);
    expect(v.sourceHealth.providers.every((p) => p.status === 'unchecked')).toBe(true);
  });

  it('does not count an offline Refresh against the providers', async () => {
    const stores = new AppStores(dir);
    await runRefresh({ config, cvFolder: dir, stores, cv: twoDomains, providers: [fake('a', 1, () => [])], isOnline: () => false, now: () => t(10), mock: false });
    expect(stores.health.value.providers).toEqual({});
  });
});
