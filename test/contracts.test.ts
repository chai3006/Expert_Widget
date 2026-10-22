import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, feedbackProblem, toCompanySignals, toDomainProfile, toNewsItem, toSourceHealth } from '../packages/core/src/contracts.js';
import { MockCvProvider, mockProviders } from '../packages/core/src/mock/mockData.js';
import { runRefresh } from '../packages/core/src/refresh.js';
import { memoryStores } from '../packages/core/src/state/appState.js';
import { buildView } from '../packages/core/src/view.js';
import { defaultConfig, defaultEmployers, defaultWatchlist, registry } from './helpers/config.js';
import { schemaErrors, schemaFiles } from './helpers/schemas.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'expert-contracts-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function mockView() {
  const config = defaultConfig();
  const stores = memoryStores();
  const now = new Date(2026, 9, 20, 9).getTime();
  await runRefresh({ config, cvFolder: dir, stores, cv: new MockCvProvider(() => now), providers: mockProviders(config), watchlist: defaultWatchlist().map((w) => w.name), isOnline: () => true, now: () => now, mock: true });
  return buildView({ mock: true, config, employers: defaultEmployers(), watchlist: defaultWatchlist(), configError: null, stores, cvFolder: dir, messages: [], refreshing: false, now });
}

describe('contracts', () => {
  it('has the six schema files, each requiring schemaVersion', () => {
    expect(schemaFiles.sort()).toEqual(
      ['CompanySignal', 'DomainProfile', 'EmployerDirectory', 'NewsItem', 'SourceHealth', 'UserFeedback'].map((n) => `${n}.v1.schema.json`),
    );
  });

  it('builds a DomainProfile that matches its schema and leaves out the file name', async () => {
    const v = await mockView();
    const profile = toDomainProfile(v.data.profile!, (d) => registry().label(d));
    expect(schemaErrors('DomainProfile', profile)).toEqual([]);
    expect(profile.weights.reduce((a, w) => a + w.weight, 0)).toBe(100);
    expect(JSON.stringify(profile)).not.toContain(v.data.profile!.fileName);
  });

  it('builds news items, company signals and source health that match their schemas', async () => {
    const v = await mockView();
    expect(v.data.news.length).toBeGreaterThan(5);
    for (const card of v.data.news) expect(schemaErrors('NewsItem', toNewsItem(card)), card.headline).toEqual([]);
    const signals = toCompanySignals(v.data.news);
    expect(signals.length).toBeGreaterThan(0);
    for (const s of signals) expect(schemaErrors('CompanySignal', s)).toEqual([]);
    expect(schemaErrors('SourceHealth', toSourceHealth(v.data.sourceHealth))).toEqual([]);
  });

  it('rejects documents that break the schema', () => {
    expect(schemaErrors('UserFeedback', { schemaVersion: 2, action: 'seen', target: 'x' })).not.toEqual([]);
    expect(schemaErrors('UserFeedback', { schemaVersion: 1, action: 'like', target: 'x' })).not.toEqual([]);
    expect(schemaErrors('CompanySignal', { schemaVersion: 1, company: 'A', tag: 'hiring_growth', date: 'yesterday', url: 'https://a.de', domain: 'all', source: 'x' })).not.toEqual([]);
  });

  it('checks incoming feedback the same way as the schema', () => {
    const ok = { schemaVersion: SCHEMA_VERSION, action: 'useful', target: 'abc' };
    expect(feedbackProblem(ok)).toBeNull();
    expect(schemaErrors('UserFeedback', ok)).toEqual([]);
    for (const bad of [null, [], { ...ok, schemaVersion: 2 }, { ...ok, action: 'like' }, { ...ok, target: '' }, { ...ok, extra: 1 }]) {
      expect(feedbackProblem(bad)).not.toBeNull();
      expect(schemaErrors('UserFeedback', bad)).not.toEqual([]);
    }
  });
});
