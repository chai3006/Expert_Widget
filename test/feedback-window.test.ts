import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canonicalUrl, itemId } from '../src/main/news/dedupe.js';
import type { NewsProvider } from '../src/main/news/provider.js';
import type { ParsedItem } from '../src/main/news/types.js';
import { runRefresh, type CvProvider } from '../src/main/refresh.js';
import { AppStores } from '../src/main/state/appState.js';
import { buildView } from '../src/main/view.js';
import { BUTTON_WINDOW, PANEL_WIDTH, clampInto, defaultButtonPosition, panelBounds, restoreButtonPosition } from '../src/main/windowGeometry.js';
import { defaultConfig } from './helpers/config.js';

const config = defaultConfig();
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'expert-feedback-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const DAY = 24 * 60 * 60 * 1000;
const t0 = new Date(2026, 9, 10, 8, 0).getTime();

const cv: CvProvider = {
  readProfile: async () => ({ ok: true, profile: { fileName: 'cv.pdf', modifiedMs: 1, computedAt: 1, weights: [{ domain: 'automotive-emobility', weight: 100 }] } }),
};

const HEADLINES = [
  'Autobauer schafft 300 neue Arbeitsplätze in Sachsen',
  'Zulieferer plant neues Werk für Elektroauto-Batterien',
  'Fahrzeughersteller expandiert und sucht Fachkräfte für Software',
];

const growth = (n: number, url = `https://www.example.com/news/${n}`): ParsedItem => ({
  url,
  headline: HEADLINES[n - 1],
  excerpt: '',
  publishedAt: new Date(t0 - n * 3600 * 1000).toISOString(),
  eventDate: null,
  eventEndDate: null,
});

/** A refresh where the ingenieur.de feed returns `items` (and nothing else is enabled). */
async function refreshWith(stores: AppStores, items: ParsedItem[], now = t0) {
  const feed: NewsProvider = { id: 'ingenieur-wirtschaft', name: 'ingenieur.de Wirtschaft', layer: 1, topic: 'hiring', domains: 'all', fetch: async () => items };
  await runRefresh({ config, cvFolder: dir, stores, cv, providers: [feed], isOnline: () => true, now: () => now, mock: false });
}

const view = (stores: AppStores, now = t0) =>
  buildView({ mock: false, config, employers: [], configError: null, stores, cvFolder: dir, messages: [], refreshing: false, now });

// The same steps main.ts runs for the three feedback IPC calls.
function thumbsDown(stores: AppStores, id: string, now = t0) {
  const card = view(stores, now).news.find((n) => n.id === id)!;
  stores.interactions.update((s) => {
    const { [id]: _drop, ...useful } = s.useful;
    return { ...s, useful, removed: { ...s.removed, [canonicalUrl(card.url)]: now } };
  });
}
function undoRemove(stores: AppStores, id: string) {
  stores.interactions.update((s) => ({ ...s, removed: Object.fromEntries(Object.entries(s.removed).filter(([url]) => itemId(url) !== id)) }));
}
function thumbsUp(stores: AppStores, id: string, now = t0) {
  if (stores.interactions.value.useful[id]) {
    stores.interactions.update((s) => {
      const { [id]: _drop, ...useful } = s.useful;
      return { ...s, useful };
    });
    return;
  }
  const { seenAt: _s, useful: _u, ...entry } = view(stores, now).news.find((n) => n.id === id)!;
  stores.interactions.update((s) => ({ ...s, useful: { ...s.useful, [id]: { ...entry, markedAt: now } } }));
}

describe('thumbs down', () => {
  it('removes a card for good: it stays away after a Refresh, even with tracking parameters', async () => {
    const stores = new AppStores(dir);
    await refreshWith(stores, [growth(1), growth(2)]);
    const id = itemId(growth(1).url);
    thumbsDown(stores, id);
    expect(view(stores).news.map((n) => n.id)).not.toContain(id);

    await refreshWith(stores, [growth(1, 'https://example.com/news/1/?utm_source=rss'), growth(2)], t0 + 3600 * 1000);
    expect(view(stores, t0 + 3600 * 1000).news.map((n) => n.headline)).toEqual([growth(2).headline]);

    // …and after a restart.
    expect(view(new AppStores(dir), t0 + 3600 * 1000).news).toHaveLength(1);
  });

  it('can be undone', async () => {
    const stores = new AppStores(dir);
    await refreshWith(stores, [growth(1), growth(2)]);
    const id = itemId(growth(1).url);
    thumbsDown(stores, id);
    undoRemove(stores, id);
    expect(view(stores).news.map((n) => n.id)).toContain(id);
  });

  it('removed cards do not count towards the new-items badge', async () => {
    const stores = new AppStores(dir);
    await refreshWith(stores, [growth(1), growth(2), growth(3)]);
    expect(view(stores).unseenCount).toBe(3);
    thumbsDown(stores, itemId(growth(2).url));
    expect(view(stores).unseenCount).toBe(2);
    stores.interactions.update((s) => ({ ...s, seen: { [itemId(growth(1).url)]: t0 } }));
    expect(view(stores).unseenCount).toBe(1);
  });

  it('also drops a thumbs up on the same card', async () => {
    const stores = new AppStores(dir);
    await refreshWith(stores, [growth(1)]);
    const id = itemId(growth(1).url);
    thumbsUp(stores, id);
    thumbsDown(stores, id);
    expect(view(stores).news).toEqual([]);
    expect(stores.interactions.value.useful).toEqual({});
  });
});

describe('thumbs up', () => {
  it('keeps the card on every Refresh, even when the source no longer lists it', async () => {
    const stores = new AppStores(dir);
    await refreshWith(stores, [growth(1), growth(2)]);
    const id = itemId(growth(1).url);
    thumbsUp(stores, id);
    await refreshWith(stores, [growth(2)], t0 + 1000);
    const cards = view(stores, t0 + 1000).news;
    expect(cards.find((n) => n.id === id)).toMatchObject({ useful: true, headline: growth(1).headline });
    expect(cards.filter((n) => n.id === id)).toHaveLength(1);
  });

  it('is exempt from the 7-day expiry, and survives a restart', async () => {
    const stores = new AppStores(dir);
    await refreshWith(stores, [growth(1), growth(2)]);
    const id = itemId(growth(1).url);
    thumbsUp(stores, id);
    const later = t0 + 30 * DAY;
    expect(view(new AppStores(dir), later).news.map((n) => n.id)).toEqual([id]);
  });

  it('keeps a career fair after its date', async () => {
    const stores = new AppStores(dir);
    const fair: NewsProvider = {
      id: 'messen-karrieremessen',
      name: 'messen.de',
      layer: 1,
      topic: 'career_fair',
      domains: 'all',
      fetch: async () => [{ url: 'https://www.messen.de/fair/1', headline: 'Karrieremesse Technik', excerpt: '', publishedAt: null, eventDate: '2026-10-20', eventEndDate: '2026-10-20' }],
    };
    await runRefresh({ config, cvFolder: dir, stores, cv, providers: [fair], isOnline: () => true, now: () => t0, mock: false });
    const id = itemId('https://www.messen.de/fair/1');
    thumbsUp(stores, id);
    expect(view(stores, new Date(2026, 9, 25).getTime()).news.map((n) => n.id)).toEqual([id]);
  });

  it('pressing it again undoes it, and the normal rules apply again', async () => {
    const stores = new AppStores(dir);
    await refreshWith(stores, [growth(1)]);
    const id = itemId(growth(1).url);
    thumbsUp(stores, id);
    thumbsUp(stores, id);
    expect(view(stores).news[0].useful).toBe(false);
    expect(view(stores, t0 + 30 * DAY).news).toEqual([]);
  });

  it('a damaged useful entry is dropped, the rest of the file is kept', () => {
    writeFileSync(
      join(dir, 'interactions.json'),
      JSON.stringify({ version: 1, visited: { bosch: 1 }, seen: {}, removed: { 'https://example.com/x': 2 }, useful: { abc: { id: 'abc' } } }),
    );
    const stores = new AppStores(dir);
    expect(stores.interactions.value).toEqual({ version: 1, visited: { bosch: 1 }, seen: {}, removed: { 'https://example.com/x': 2 }, useful: {} });
    expect(stores.recoveredFiles()).toEqual([]);
  });
});

describe('window state', () => {
  it('starts collapsed, remembers mode and button position, and reads the old format', () => {
    const fresh = new AppStores(dir);
    expect(fresh.ui.value).toEqual({ version: 2, theme: 'day', mode: 'collapsed', button: null });
    fresh.ui.update((u) => ({ ...u, mode: 'expanded', button: { x: 100, y: 200, displayId: 7 } }));
    expect(new AppStores(dir).ui.value).toMatchObject({ mode: 'expanded', button: { x: 100, y: 200, displayId: 7 } });

    writeFileSync(join(dir, 'ui.json'), JSON.stringify({ version: 1, theme: 'dark', bounds: { x: 1, y: 2, width: 420, height: 900 } }));
    const migrated = new AppStores(dir);
    expect(migrated.ui.value).toEqual({ version: 2, theme: 'dark', mode: 'collapsed', button: null });
    expect(migrated.recoveredFiles()).toEqual([]);
  });

  it('a Refresh never changes the window state', async () => {
    const stores = new AppStores(dir);
    stores.ui.update((u) => ({ ...u, mode: 'collapsed', button: { x: 5, y: 6, displayId: null } }));
    const before = readFileSync(join(dir, 'ui.json'), 'utf8');
    await refreshWith(stores, [growth(1)]);
    expect(readFileSync(join(dir, 'ui.json'), 'utf8')).toBe(before);
    expect(view(stores).mode).toBe('collapsed');
  });
});

describe('window geometry', () => {
  const primary = { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
  const right = { id: 2, workArea: { x: 1920, y: 0, width: 2560, height: 1400 } };

  it('docks the panel to the right edge of a screen, full work-area height', () => {
    expect(panelBounds(primary.workArea)).toEqual({ x: 1920 - PANEL_WIDTH, y: 0, width: PANEL_WIDTH, height: 1040 });
    expect(panelBounds(right.workArea)).toEqual({ x: 1920 + 2560 - PANEL_WIDTH, y: 0, width: PANEL_WIDTH, height: 1400 });
  });

  it('puts the button on the primary screen the first time', () => {
    const pos = restoreButtonPosition(null, [primary, right], primary);
    expect(pos).toEqual(defaultButtonPosition(primary.workArea));
    expect(pos.x + BUTTON_WINDOW).toBeLessThanOrEqual(1920);
  });

  it('restores a button on an extended screen', () => {
    expect(restoreButtonPosition({ x: 2500, y: 300, displayId: 2 }, [primary, right], primary)).toEqual({ x: 2500, y: 300 });
  });

  it('falls back to the primary screen when the saved screen is gone', () => {
    expect(restoreButtonPosition({ x: 2500, y: 300, displayId: 2 }, [primary], primary)).toEqual(defaultButtonPosition(primary.workArea));
  });

  it('nudges a button that hangs over the edge back inside', () => {
    expect(restoreButtonPosition({ x: 1870, y: -10, displayId: 1 }, [primary], primary)).toEqual({ x: 1920 - BUTTON_WINDOW, y: 0 });
    expect(clampInto(right.workArea, 1915, 1390)).toEqual({ x: 1920, y: 1400 - BUTTON_WINDOW });
  });
});
