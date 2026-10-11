import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NewsProvider } from '../src/main/news/provider.js';
import type { ParsedItem, RawItem } from '../src/main/news/types.js';
import { runRefresh, translateNew, type CvProvider } from '../src/main/refresh.js';
import { AppStores, type SourceCache } from '../src/main/state/appState.js';
import { looksGerman, unpacked, type Translator } from '../src/main/translate/translator.js';
import { buildView } from '../src/main/view.js';
import { defaultConfig } from './helpers/config.js';

const config = defaultConfig();
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'expert-translate-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Fake translator: prefixes "EN:" and records what it was asked. */
function fakeTranslator(fail = false) {
  const asked: string[][] = [];
  let closed = 0;
  const t: Translator = {
    translate: async (texts) => {
      asked.push(texts);
      if (fail) throw new Error('the translation model is missing (vocab.deen.spm)');
      return texts.map((x) => `EN: ${x}`);
    },
    close: async () => {
      closed++;
    },
  };
  return { t, asked, closed: () => closed };
}

describe('looksGerman', () => {
  it('spots German headlines and summaries', () => {
    expect(looksGerman('Autobauer kündigt Stellenabbau in der Verwaltung an')).toBe(true);
    expect(looksGerman('Batterie-Startup schließt Finanzierungsrunde über 15 Millionen Euro ab')).toBe(true);
    expect(looksGerman('Bis 2028 sollen rund 2.000 Stellen wegfallen, die Entwicklung ist nicht betroffen.')).toBe(true);
  });

  it('leaves English texts and bare names alone', () => {
    expect(looksGerman('Aaronia: 150 new jobs planned')).toBe(false);
    expect(looksGerman('Software house hiring 80 engineers for cloud and machine learning')).toBe(false);
    expect(looksGerman('Article on example.de, found by the GDELT news search.')).toBe(false);
    expect(looksGerman('VDI nachrichten Recruiting Tag Hamburg')).toBe(false);
    expect(looksGerman('WESER-JOBS')).toBe(false);
  });
});

describe('translateNew', () => {
  const raw = (headline: string, excerpt: string): RawItem => ({
    url: `https://example.com/${encodeURIComponent(headline)}`,
    headline,
    excerpt,
    publishedAt: '2026-10-09T08:00:00.000Z',
    eventDate: null,
    eventEndDate: null,
    sourceId: 's',
    sourceName: 'S',
    topic: 'hiring',
    firstSeen: 1,
  });
  const cacheOf = (items: RawItem[]): Record<string, SourceCache> => ({ s: { fetchedAt: 1, items, lastError: null, lastErrorAt: null } });

  it('translates only German texts, in one batch, and marks English ones as done', async () => {
    const { t, asked } = fakeTranslator();
    const cache = cacheOf([raw('Werk schafft neue Arbeitsplätze in Sachsen', 'Der Zulieferer baut aus.'), raw('Aaronia: 150 new jobs planned', 'Business expansion · Manufacturing · Germany')]);
    expect(await translateNew(cache, t)).toBe(2);
    expect(asked).toEqual([['Werk schafft neue Arbeitsplätze in Sachsen', 'Der Zulieferer baut aus.']]);
    expect(cache.s.items[0].translation).toEqual({ headline: 'EN: Werk schafft neue Arbeitsplätze in Sachsen', excerpt: 'EN: Der Zulieferer baut aus.' });
    expect(cache.s.items[1].translation).toEqual({ headline: null, excerpt: null });
    // Nothing left to do the second time.
    expect(await translateNew(cache, t)).toBe(0);
  });

  it('keeps career fair titles (event names) and translates only their descriptions', async () => {
    const { t, asked } = fakeTranslator();
    const fair: RawItem = { ...raw('Job- und Ausbildungsmesse Solingen', 'Karrieremesse für Schüler und Studenten · Solingen'), topic: 'career_fair', publishedAt: null };
    const cache = cacheOf([fair]);
    await translateNew(cache, t);
    expect(asked).toEqual([['Karrieremesse für Schüler und Studenten · Solingen']]);
    expect(cache.s.items[0].translation).toEqual({ headline: null, excerpt: 'EN: Karrieremesse für Schüler und Studenten · Solingen' });
  });

  it('leaves items untranslated (to retry later) when the translator fails', async () => {
    const { t } = fakeTranslator(true);
    const cache = cacheOf([raw('Werk schafft neue Arbeitsplätze in Sachsen', '')]);
    await expect(translateNew(cache, t)).rejects.toThrow(/model is missing/);
    expect(cache.s.items[0].translation).toBeUndefined();
  });
});

describe('translation in Refresh and the view', () => {
  const cv: CvProvider = {
    readProfile: async () => ({ ok: true, profile: { fileName: 'cv.pdf', modifiedMs: 1, computedAt: 1, weights: [{ domain: 'automotive-emobility', weight: 100 }] } }),
  };
  const item: ParsedItem = {
    url: 'https://example.com/werk',
    headline: 'Autobauer schafft 300 neue Arbeitsplätze in Sachsen',
    excerpt: 'Das neue Werk soll 2027 eröffnen.',
    publishedAt: '2026-10-09T08:00:00.000Z',
    eventDate: null,
    eventEndDate: null,
  };
  const feed = (items: ParsedItem[]): NewsProvider => ({ id: 'ingenieur-wirtschaft', name: 'ingenieur.de Wirtschaft', layer: 1, topic: 'hiring', domains: 'all', fetch: async () => items });
  const now = new Date(2026, 9, 10, 8).getTime();
  const refresh = (stores: AppStores, translator: Translator, items = [item]) =>
    runRefresh({ config, cvFolder: dir, stores, cv, providers: [feed(items)], isOnline: () => true, translator, now: () => now, mock: false });
  const view = (stores: AppStores) => buildView({ mock: false, config, employers: [], watchlist: [], configError: null, stores, cvFolder: dir, messages: [], refreshing: false, now });

  it('stores the translation and shows it on the card next to the original', async () => {
    const stores = new AppStores(dir);
    const { t, closed } = fakeTranslator();
    await refresh(stores, t);
    expect(closed()).toBe(1);
    const card = view(stores).news[0];
    expect(card.headline).toBe(item.headline);
    expect(card.translated).toEqual({ headline: `EN: ${item.headline}`, summary: `EN: ${item.excerpt}` });
    // Classification still uses the original German keywords.
    expect(card.tag).toBe('hiring_growth');
  });

  it('reuses translations on the next Refresh and translates again only when the text changed', async () => {
    const stores = new AppStores(dir);
    await refresh(stores, fakeTranslator().t);
    const second = fakeTranslator();
    await refresh(stores, second.t);
    expect(second.asked).toEqual([]);
    const third = fakeTranslator();
    await refresh(stores, third.t, [{ ...item, excerpt: 'Das neue Werk soll 2028 eröffnen.' }]);
    expect(third.asked).toEqual([[item.headline, 'Das neue Werk soll 2028 eröffnen.']]);
  });

  it('a missing model only adds a note; the news still loads in German', async () => {
    const stores = new AppStores(dir);
    const messages = await refresh(stores, fakeTranslator(true).t);
    expect(messages).toEqual([
      { level: 'info', text: 'English translation is not available this time (the translation model is missing (vocab.deen.spm)). Showing the original texts.' },
    ]);
    expect(view(stores).news[0]).toMatchObject({ headline: item.headline, translated: null });
  });

  it('a thumbs-up card saved before translation existed still loads', () => {
    const stores = new AppStores(dir);
    stores.interactions.update((s) => ({
      ...s,
      useful: {
        abc: { id: 'abc', tag: 'hiring_growth', headline: 'Alt', summary: '', url: 'https://example.com/alt', sourceName: 'X', domain: 'all', domainLabel: 'All domains', date: '2026-10-01T00:00:00.000Z', eventDate: null, eventEndDate: null, markedAt: 1 },
      },
    }));
    expect(view(new AppStores(dir)).news[0]).toMatchObject({ id: 'abc', useful: true, translated: null });
  });
});

describe('packaged paths', () => {
  it('points unpacked files next to app.asar', () => {
    const p = join('C:', 'Program Files', 'Expert Widget', 'resources', 'app.asar', 'dist', 'main', 'translate', 'worker.js');
    expect(unpacked(p)).toBe(join('C:', 'Program Files', 'Expert Widget', 'resources', 'app.asar.unpacked', 'dist', 'main', 'translate', 'worker.js'));
    expect(unpacked(join('C:', 'dev', 'dist', 'x.js'))).toBe(join('C:', 'dev', 'dist', 'x.js'));
  });
});
