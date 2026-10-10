// Builds the complete view model the renderer displays.

import { orderCompanies, orderNews } from '../shared/ordering.js';
import { DOMAIN_LABELS, type DomainWeight, type EmployerDomainView, type StatusMessage, type ViewModel } from '../shared/types.js';
import type { AppConfig, EmployerSegment } from './config.js';
import { RuleBasedClassifier } from './news/classifier.js';
import { buildNewsCards } from './news/pipeline.js';
import type { AppStores } from './state/appState.js';

export function companyKey(name: string): string {
  return name.trim().toLowerCase();
}

export function buildEmployerView(
  segments: readonly EmployerSegment[],
  weights: readonly DomainWeight[],
  visited: Readonly<Record<string, number>>,
): EmployerDomainView[] {
  return weights.map(({ domain, weight }) => ({
    domain,
    label: DOMAIN_LABELS[domain],
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

export interface ViewInput {
  mock: boolean;
  config: AppConfig | null;
  employers: EmployerSegment[];
  configError: string | null;
  stores: AppStores;
  cvFolder: string;
  messages: StatusMessage[];
  refreshing: boolean;
  now: number;
}

export function buildView(input: ViewInput): ViewModel {
  const { stores, config } = input;
  const ui = stores.ui.value;
  const base: ViewModel = {
    mock: input.mock,
    configError: input.configError,
    theme: ui.theme,
    lastUpdated: stores.feed.value.lastUpdated,
    refreshing: input.refreshing,
    messages: input.messages,
    cvFolder: input.cvFolder,
    cvStatus: null,
    profile: null,
    employers: [],
    news: [],
    hasData: false,
  };
  if (input.configError || !config) return base;

  const { profile, lastProblem } = stores.profile.value;
  const weights = profile?.weights ?? [];
  const { visited, seen } = stores.interactions.value;
  const news = buildNewsCards({
    cache: stores.feed.value,
    config,
    weights,
    classifier: new RuleBasedClassifier(config.keywords),
    seen,
    now: input.now,
    allowMock: input.mock,
  });

  return {
    ...base,
    cvStatus: lastProblem ? { level: 'warning', text: lastProblem } : null,
    profile,
    employers: buildEmployerView(input.employers, weights, visited),
    news: orderNews(news),
    hasData: profile !== null || stores.feed.value.lastUpdated !== null,
  };
}
