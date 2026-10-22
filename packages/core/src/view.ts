// Builds the complete view model the renderer displays.

import type { EmployerDirectory } from './contracts.js';
import { visibleSegments } from './directory.js';
import { companyKey, orderCompanies, orderNews, watchlistKey } from './shared/ordering.js';
import {
  type DomainWeight,
  type EmployerDomainView,
  type ExpertData,
  type NewsCard,
  type ProviderStatus,
  type SourceHealthView,
  type StatusMessage,
  type UiView,
  type ViewModel,
  type WatchlistChip,
} from './shared/types.js';
import { enabledProviders, type AppConfig, type EmployerSegment, type ProviderInfo, type WatchlistEntry } from './config.js';
import { RuleBasedClassifier } from './news/classifier.js';
import { buildNewsCards } from './news/pipeline.js';
import { effectiveProfile, type AppStores, type HealthState } from './state/appState.js';
import { NEEDS_ATTENTION_AFTER } from './refresh.js';

export { companyKey };

/**
 * Employers per domain in the mix: the verified starter list (data/employers) in tier order, then
 * the user's own employers.json segments without the companies the starter list already has.
 */
export function buildEmployerView(
  segments: readonly EmployerSegment[],
  weights: readonly DomainWeight[],
  visited: Readonly<Record<string, number>>,
  labelOf: (domain: string) => string = (d) => d,
  directories: readonly EmployerDirectory[] = [],
): EmployerDomainView[] {
  const chip = (name: string, careerUrl: string) => {
    const key = companyKey(name);
    return { key, name, careerUrl, visitedAt: visited[key] ?? null };
  };
  return weights.map(({ domain, weight }) => {
    const directory = directories.find((d) => d.domain === domain);
    const starter = directory ? visibleSegments(directory) : [];
    const listed = new Set(starter.flatMap((s) => s.companies.map((c) => companyKey(c.name))));
    const own = segments
      .filter((s) => s.domain === domain)
      .map((s) => ({ segment: s.segment, tier: null, companies: orderCompanies(s.companies.filter((c) => !listed.has(companyKey(c.name))).map((c) => chip(c.name, c.careerUrl))) }))
      .filter((s) => s.companies.length > 0);
    return {
      domain,
      label: labelOf(domain),
      weight,
      starterList: starter.length > 0,
      segments: [...starter.map((s) => ({ segment: s.label.en, tier: s.tier as string | null, companies: orderCompanies(s.companies.map((c) => chip(c.name, c.careerUrl))) })), ...own],
    };
  });
}

/** Watchlist chips in file order (visited ones last), each with its count of new news cards. */
export function buildWatchlistView(
  entries: readonly WatchlistEntry[],
  news: readonly NewsCard[],
  visited: Readonly<Record<string, number>>,
): WatchlistChip[] {
  return orderCompanies(
    entries.map((e) => {
      const key = watchlistKey(e.name);
      return {
        key,
        name: e.name,
        website: e.website || null,
        note: e.note,
        visitedAt: visited[key] ?? null,
        newsCount: news.filter((n) => n.seenAt === null && n.watchlist.some((w) => companyKey(w) === companyKey(e.name))).length,
      };
    }),
  );
}

export interface ViewInput {
  mock: boolean;
  /** win32, darwin, linux or web. */
  platform?: string;
  canManageFolder?: boolean;
  config: AppConfig | null;
  employers: EmployerSegment[];
  watchlist: WatchlistEntry[];
  configError: string | null;
  stores: AppStores;
  cvFolder: string;
  messages: StatusMessage[];
  refreshing: boolean;
  now: number;
}

export function buildView(input: ViewInput): ViewModel {
  const { stores, config } = input;
  const uiState = stores.ui.value;
  const ui: UiView = {
    mock: input.mock,
    configError: input.configError,
    theme: uiState.theme,
    refreshing: input.refreshing,
    messages: input.messages,
    cvFolder: input.cvFolder,
    cvStatus: null,
    cvProblemKind: null,
    platform: input.platform ?? 'web',
    canManageFolder: input.canManageFolder ?? false,
    watchlistSearch: uiState.watchlistSearch !== false,
    unseenCount: 0,
    mode: uiState.mode,
    hasData: false,
  };
  const data: ExpertData = {
    lastUpdated: stores.feed.value.lastUpdated,
    domains: [],
    profile: null,
    employers: [],
    watchlist: [],
    news: [],
    sourceHealth: { working: 0, total: 0, providers: [] },
  };
  if (input.configError || !config) return { ui, data };

  const { lastProblem, lastProblemKind } = stores.profile.value;
  const profile = effectiveProfile(stores.profile.value);
  const weights = profile?.weights ?? [];
  const { visited, seen, removed, useful } = stores.interactions.value;
  const providers = enabledProviders(config);
  const news = orderNews(
    buildNewsCards({
      cache: stores.feed.value,
      config,
      weights,
      classifier: new RuleBasedClassifier(config.keywords),
      providers,
      watchlist: input.watchlist.map((w) => w.name),
      seen,
      removed,
      useful,
      now: input.now,
      allowMock: input.mock,
    }),
  );

  return {
    ui: {
      ...ui,
      cvStatus: lastProblem ? { level: 'warning', text: lastProblem } : null,
      cvProblemKind: lastProblem ? (lastProblemKind ?? 'unreadable') : null,
      unseenCount: news.filter((n) => n.seenAt === null).length,
      hasData: profile !== null || stores.feed.value.lastUpdated !== null,
    },
    data: {
      ...data,
      profile,
      domains: config.domains.domains.map((d) => ({ id: d.id, label: d.label.en, shortLabel: d.shortLabel.en })),
      employers: buildEmployerView(input.employers, weights, visited, (d) => config.domains.label(d), config.directory),
      watchlist: buildWatchlistView(input.watchlist, news, visited),
      news,
      sourceHealth: buildSourceHealth(providers, stores.health.value),
    },
  };
}

export function buildSourceHealth(providers: readonly ProviderInfo[], health: HealthState): SourceHealthView {
  const list = providers.map((p) => {
    const r = health.providers[p.id];
    return {
      id: p.id,
      name: p.name,
      layer: p.layer,
      status: (r?.status ?? 'unchecked') as ProviderStatus,
      checkedAt: r?.checkedAt ?? null,
      itemCount: r?.itemCount ?? 0,
      detail: r?.lastError ?? null,
      needsAttention: (r?.consecutiveFailures ?? 0) >= NEEDS_ATTENTION_AFTER,
    };
  });
  const checked = list.filter((p) => p.status !== 'unchecked');
  return { working: checked.filter((p) => p.status !== 'failed').length, total: checked.length, providers: list };
}
