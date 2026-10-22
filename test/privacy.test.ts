// Privacy of the news requests (Phase 5): nothing derived from the CV is ever sent. Every user's
// Refresh asks the same URLs; only watchlist company names (chosen by the user, and switchable off)
// add requests of their own. These tests fail if a query is ever built from CV-derived data.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ExpertEngine } from '../packages/core/src/engine.js';
import { buildProviders } from '../packages/core/src/news/providers.js';
import type { Fetcher } from '../packages/core/src/ports.js';
import { runRefresh, type CvProvider } from '../packages/core/src/refresh.js';
import { memoryStores } from '../packages/core/src/state/appState.js';
import { LocalCvProvider } from '../packages/node/src/cv/folderCvSource.js';
import { defaultConfig, defaultEmployers, fixture } from './helpers/config.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'expert-privacy-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Records every URL and answers with an empty but valid body. */
function recordingFetcher(): { fetcher: Fetcher; urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    fetcher: {
      getText: async (url: string) => {
        urls.push(url);
        if (url.includes('gdeltproject')) return '{}';
        return '<rss><channel></channel></rss>';
      },
    },
  };
}

const profile = (domain: string): CvProvider => ({
  readProfile: async () => ({ ok: true, profile: { fileName: 'cv.pdf', modifiedMs: 1, computedAt: 1, weights: [{ domain, weight: 100 }] } }),
});

async function requestsFor(cv: CvProvider, watchlist: string[] = []): Promise<string[]> {
  const config = { ...defaultConfig(), search: { ...defaultConfig().search, googleNews: { enabled: true } } };
  const { fetcher, urls } = recordingFetcher();
  await runRefresh({ config, cvFolder: dir, stores: memoryStores(), cv, providers: buildProviders(config, fetcher), watchlist, isOnline: () => true, now: () => Date.UTC(2026, 9, 20), mock: false });
  return urls.sort();
}

describe('news requests', () => {
  it('are exactly the same for a nurse, an engineer, a lawyer and no CV at all', async () => {
    const nurse = await requestsFor(profile('healthcare-nursing'));
    expect(nurse.length).toBeGreaterThan(10);
    expect(await requestsFor(profile('automotive-emobility'))).toEqual(nurse);
    expect(await requestsFor(profile('law-compliance'))).toEqual(nurse);
    expect(await requestsFor({ readProfile: async () => ({ ok: false, problem: 'No CV found.' }) })).toEqual(nurse);
  });

  it('contain no word of the CV', async () => {
    const cvText = fixture('cv', 'fields', 'nurse-de.txt');
    writeFileSync(join(dir, 'cv.txt'), cvText);
    const urls = await requestsFor(new LocalCvProvider(undefined, () => Date.UTC(2026, 9, 1)));
    const sent = decodeURIComponent(urls.join(' ').replace(/[+]/g, ' ')).toLowerCase();
    // Words of the CV that are not among the fixed topic and signal words.
    for (const word of ['anna', 'beispiel', 'musterstadt', 'pflegefachkraft', 'intensivstation', 'vitalzeichen', 'praxisanleiterin', 'krankenpflegerin']) {
      expect(sent, word).not.toContain(word);
    }
  });

  it('add only one request per watchlist company, by name', async () => {
    const base = await requestsFor(profile('healthcare-nursing'));
    const withWatchlist = await requestsFor(profile('healthcare-nursing'), ['Beispiel Klinikum']);
    const extra = withWatchlist.filter((u) => !base.includes(u));
    expect(extra.length).toBe(2); // GDELT and Google News, one each
    for (const u of extra) expect(decodeURIComponent(u.replace(/\+/g, ' '))).toContain('"Beispiel Klinikum"');
  });

  it('leave out the watchlist names when the user switches watchlist searching off', async () => {
    const config = defaultConfig();
    const { fetcher, urls } = recordingFetcher();
    const engine = new ExpertEngine({
      loadInputs: () => ({ ok: true, config, employers: defaultEmployers(), watchlist: [{ name: 'Beispiel Klinikum', website: '', note: '', addedAt: '', lastVerified: '' }], cvFolder: dir }),
      stores: memoryStores(),
      cv: profile('healthcare-nursing'),
      providers: (c) => buildProviders(c, fetcher),
      isOnline: () => true,
      now: () => Date.UTC(2026, 9, 20),
    });
    engine.setWatchlistSearch(false);
    await engine.refresh();
    expect(urls.length).toBeGreaterThan(10);
    expect(decodeURIComponent(urls.join(' ').replace(/[+]/g, ' '))).not.toContain('Beispiel Klinikum');
  });
});
