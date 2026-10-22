// Builds the complete view model the renderer displays.

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

export function buildEmployerView(
  segments: readonly EmployerSegment[],
  weights: readonly DomainWeight[],
  visited: Readonly<Record<string, number>>,
  labelOf: (domain: string) => string = (d) => d,
): EmployerDomainView[] {
  return weights.map(({ domain, weight }) => ({
    domain,
    label: labelOf(domain),
    weight,
    segments: segments
      .filter((s) => s.domain === domain)
      .map((s) => ({
        segment: s.segment,
        companies: orderCompanies(
          s.companies.map((c) => {
            const key = companyKey(c.name);
            return { key, name: c.name, careerUrl: c.careerUrl, visitedAt: visited[key] ?? null };
          }),
        ),
      })),
  }));
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

  const { lastProblem } = stores.profile.value;
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
      unseenCount: news.filter((n) => n.seenAt === null).length,
      hasData: profile !== null || stores.feed.value.lastUpdated !== null,
    },
    data: {
      ...data,
      profile,
      domains: config.domains.domains.map((d) => ({ id: d.id, label: d.label.en, shortLabel: d.shortLabel.en })),
      employers: buildEmployerView(input.employers, weights, visited, (d) => config.domains.label(d)),
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
