import { describe, expect, it } from 'vitest';
import { ExpertEngine } from '../packages/core/src/engine.js';
import { MockCvProvider, mockProviders } from '../packages/core/src/mock/mockData.js';
import { memoryStores } from '../packages/core/src/state/appState.js';
import { defaultConfig, defaultEmployers, defaultWatchlist } from './helpers/config.js';

const now = new Date(2026, 9, 20, 9).getTime();

function engine() {
  const config = defaultConfig();
  let changes = 0;
  const e = new ExpertEngine({
    loadInputs: () => ({ ok: true, config, employers: defaultEmployers(), watchlist: defaultWatchlist(), cvFolder: 'cv' }),
    stores: memoryStores(),
    cv: new MockCvProvider(() => now),
    providers: (c) => mockProviders(c),
    isOnline: () => true,
    now: () => now,
    mock: true,
    onChange: () => changes++,
  });
  return { e, changes: () => changes };
}

describe('ExpertEngine', () => {
  it('runs one Refresh at a time and reports the refreshing state', async () => {
    const { e, changes } = engine();
    const a = e.refresh();
    expect(e.refreshing).toBe(true);
    expect(e.view().ui.refreshing).toBe(true);
    expect(e.refresh()).toBe(a);
    await a;
    expect(e.refreshing).toBe(false);
    expect(changes()).toBe(2);
    expect(e.view().data.news.length).toBeGreaterThan(0);
  });

  it('applies seen, useful, not useful and undo', async () => {
    const { e } = engine();
    await e.refresh();
    const first = e.view().data.news[0];
    e.feedback({ action: 'seen', target: first.id });
    expect(e.view().data.news.find((n) => n.id === first.id)?.seenAt).toBe(now);
    e.feedback({ action: 'useful', target: first.id });
    expect(e.view().data.news.find((n) => n.id === first.id)?.useful).toBe(true);
    e.feedback({ action: 'useful', target: first.id });
    expect(e.view().data.news.find((n) => n.id === first.id)?.useful).toBe(false);
    e.feedback({ action: 'not-useful', target: first.id });
    expect(e.view().data.news.some((n) => n.id === first.id)).toBe(false);
    e.feedback({ action: 'undo-not-useful', target: first.id });
    expect(e.view().data.news.some((n) => n.id === first.id)).toBe(true);
    e.feedback({ action: 'not-useful', target: 'unknown-id' });
    expect(e.view().data.news.length).toBeGreaterThan(0);
  });

  it('marks a company visited by its key', async () => {
    const { e } = engine();
    await e.refresh();
    const chip = e.view().data.employers[0].segments[0].companies[0];
    e.feedback({ action: 'visited', target: chip.key });
    const after = e.view().data.employers[0].segments[0].companies;
    expect(after[after.length - 1]).toMatchObject({ key: chip.key, visitedAt: now });
  });

  it('shows a configuration error and does not refresh', async () => {
    const e = new ExpertEngine({
      loadInputs: () => ({ ok: false, error: 'config.json has problems', cvFolder: 'cv' }),
      stores: memoryStores(),
      cv: new MockCvProvider(() => now),
      providers: () => {
        throw new Error('must not be called');
      },
      isOnline: () => true,
      now: () => now,
    });
    await e.refresh();
    expect(e.view().ui.configError).toBe('config.json has problems');
  });
});
