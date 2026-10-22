// One Expert instance: inputs (config, employers, watchlist), state, the CV and the news providers,
// wired together. The desktop app, the CLI and the local HTTP service all drive the same engine,
// so a Refresh, the view and feedback behave identically everywhere. Everything outside the core
// (files, network, Electron) comes in through EngineDeps.

import type { AppConfig, EmployerSegment, WatchlistEntry } from './config.js';
import type { DomainRegistry } from './domains.js';
import {
  toCompanySignals,
  toDomainProfile,
  toNewsItem,
  toSourceHealth,
  type CompanySignal,
  type DomainProfile,
  type NewsItem,
  type SourceHealth,
  type UserFeedback,
} from './contracts.js';
import { canonicalUrl, itemId } from './news/dedupe.js';
import type { NewsProvider } from './news/provider.js';
import type { Clock, Translator } from './ports.js';
import { runRefresh, type CvProvider } from './refresh.js';
import { companyKey } from './shared/ordering.js';
import type { DomainWeight, StatusMessage, ViewModel } from './shared/types.js';
import { effectiveProfile, type AppStores } from './state/appState.js';
import { buildView } from './view.js';

export interface EngineInputs {
  config: AppConfig;
  employers: EmployerSegment[];
  watchlist: WatchlistEntry[];
  cvFolder: string;
}

export type InputsResult = ({ ok: true } & EngineInputs) | { ok: false; error: string; cvFolder: string };

export interface EngineDeps {
  /** Reads the inputs again; called at start and before every Refresh, so edits apply. */
  loadInputs(): InputsResult;
  stores: AppStores;
  cv: CvProvider;
  /** The enabled news providers for this config, in priority order. */
  providers(config: AppConfig): NewsProvider[];
  isOnline(): boolean;
  /** A fresh translator per Refresh, or null to keep the original texts. */
  translator?(): Translator | null;
  now: Clock;
  /** Mock runs tag every item so they can never leak into a normal run's view. */
  mock?: boolean;
  /** Called when the refreshing state changes, so a UI can show it. */
  onChange?(): void;
  /** Domain labels for the contracts. */
  labelOf?(domain: string): string;
}

export class ExpertEngine {
  private inputs: InputsResult;
  private messages: StatusMessage[] = [];
  private running: Promise<void> | null = null;

  constructor(private readonly deps: EngineDeps) {
    this.inputs = deps.loadInputs();
  }

  get current(): InputsResult {
    return this.inputs;
  }

  get refreshing(): boolean {
    return this.running !== null;
  }

  /** Reads the inputs again without fetching anything. */
  reload(): InputsResult {
    this.inputs = this.deps.loadInputs();
    return this.inputs;
  }

  /** One Refresh. A second call while one runs waits for the same Refresh. */
  refresh(): Promise<void> {
    if (this.running) return this.running;
    this.running = (async () => {
      const inputs = this.reload();
      if (!inputs.ok) {
        this.messages = [];
        return;
      }
      try {
        this.messages = await runRefresh({
          config: inputs.config,
          cvFolder: inputs.cvFolder,
          stores: this.deps.stores,
          cv: this.deps.cv,
          providers: this.deps.providers(inputs.config),
          watchlist: inputs.watchlist.map((w) => w.name),
          isOnline: this.deps.isOnline,
          translator: this.deps.translator?.() ?? null,
          now: this.deps.now,
          mock: this.deps.mock ?? false,
        });
      } catch (err) {
        this.messages = [{ level: 'error', text: `Refresh failed: ${err instanceof Error ? err.message : String(err)}` }];
      }
    })().finally(() => {
      this.running = null;
      this.deps.onChange?.();
    });
    this.deps.onChange?.();
    return this.running;
  }

  view(): ViewModel {
    const recovered = this.deps.stores.recoveredFiles();
    const notes: StatusMessage[] = recovered.length
      ? [{ level: 'info', text: `A damaged state file was set aside and started fresh: ${recovered.join(', ')}` }]
      : [];
    const inputs = this.inputs;
    return buildView({
      mock: this.deps.mock ?? false,
      config: inputs.ok ? inputs.config : null,
      employers: inputs.ok ? inputs.employers : [],
      watchlist: inputs.ok ? inputs.watchlist : [],
      configError: inputs.ok ? null : inputs.error,
      stores: this.deps.stores,
      cvFolder: inputs.cvFolder,
      messages: [...notes, ...this.messages],
      refreshing: this.refreshing,
      now: this.deps.now(),
    });
  }

  // ---- Feedback ----------------------------------------------------------------------------

  /** Applies one user action. Unknown news ids are ignored. */
  feedback(f: Pick<UserFeedback, 'action' | 'target'>): void {
    const { stores } = this.deps;
    const now = this.deps.now();
    const id = f.target;
    switch (f.action) {
      case 'visited':
        // Clicking again moves the company to the very end again.
        stores.interactions.update((s) => ({ ...s, visited: { ...s.visited, [companyKey(id)]: now } }));
        return;
      case 'seen':
        stores.interactions.update((s) => (s.seen[id] ? s : { ...s, seen: { ...s.seen, [id]: now } }));
        return;
      case 'not-useful': {
        const card = this.view().data.news.find((n) => n.id === id);
        if (!card) return;
        stores.interactions.update((s) => {
          const { [id]: _dropped, ...useful } = s.useful;
          return { ...s, useful, removed: { ...s.removed, [canonicalUrl(card.url)]: now } };
        });
        return;
      }
      case 'undo-not-useful':
        stores.interactions.update((s) => ({ ...s, removed: Object.fromEntries(Object.entries(s.removed).filter(([url]) => itemId(url) !== id)) }));
        return;
      case 'useful': {
        if (stores.interactions.value.useful[id]) {
          stores.interactions.update((s) => {
            const { [id]: _dropped, ...useful } = s.useful;
            return { ...s, useful };
          });
          return;
        }
        // The card is taken from the engine's own view, never from the caller.
        const card = this.view().data.news.find((n) => n.id === id);
        if (card) {
          const { seenAt: _seenAt, useful: _useful, ...entry } = card;
          stores.interactions.update((s) => ({ ...s, useful: { ...s.useful, [id]: { ...entry, markedAt: now } } }));
        }
        return;
      }
    }
  }

  // ---- Domains chosen by hand ----------------------------------------------------------------

  /**
   * Replaces the automatic domain mix with the user's choice: 1 to 4 known domains with positive
   * shares, normalised to whole numbers summing to 100. Returns an error text or null.
   */
  setManualDomains(choice: ReadonlyArray<{ domain: string; weight: number }>): string | null {
    const inputs = this.inputs;
    if (!inputs.ok) return 'The configuration has problems; fix it first.';
    const weights = normaliseManualWeights(choice, inputs.config.domains);
    if (typeof weights === 'string') return weights;
    this.deps.stores.profile.update((p) => ({ ...p, manual: { weights, setAt: this.deps.now() } }));
    return null;
  }

  /** Back to the mix computed from the CV. */
  clearManualDomains(): void {
    this.deps.stores.profile.update((p) => ({ ...p, manual: null }));
  }

  // ---- Contracts ---------------------------------------------------------------------------

  private label(domain: string): string {
    if (this.deps.labelOf) return this.deps.labelOf(domain);
    return this.inputs.ok ? this.inputs.config.domains.label(domain) : domain;
  }

  domainProfile(): DomainProfile | null {
    const profile = effectiveProfile(this.deps.stores.profile.value);
    return profile ? toDomainProfile(profile, (d) => this.label(d)) : null;
  }

  newsItems(): NewsItem[] {
    return this.view().data.news.map(toNewsItem);
  }

  companySignals(): CompanySignal[] {
    return toCompanySignals(this.view().data.news);
  }

  sourceHealth(): SourceHealth {
    return toSourceHealth(this.view().data.sourceHealth);
  }
}

export const MAX_MANUAL_DOMAINS = 4;

/** Checks and normalises a hand-made domain choice (largest remainder, ties in the given order). */
export function normaliseManualWeights(choice: ReadonlyArray<{ domain: string; weight: number }>, registry: DomainRegistry): DomainWeight[] | string {
  const picked = choice.filter((c) => c.weight > 0);
  if (picked.length === 0) return 'Choose at least one domain.';
  if (picked.length > MAX_MANUAL_DOMAINS) return `Choose at most ${MAX_MANUAL_DOMAINS} domains.`;
  const seen = new Set<string>();
  for (const c of picked) {
    if (!registry.has(c.domain)) return `Unknown domain "${c.domain}".`;
    if (seen.has(c.domain)) return `"${c.domain}" is listed twice.`;
    if (!Number.isFinite(c.weight)) return 'Shares must be numbers.';
    seen.add(c.domain);
  }
  const total = picked.reduce((a, c) => a + c.weight, 0);
  const exact = picked.map((c, i) => ({ domain: c.domain, i, exact: (c.weight / total) * 100 }));
  const out = exact.map((e) => ({ ...e, weight: Math.floor(e.exact) }));
  let left = 100 - out.reduce((a, o) => a + o.weight, 0);
  for (const o of [...out].sort((a, b) => b.exact - b.weight - (a.exact - a.weight) || a.i - b.i)) {
    if (left <= 0) break;
    o.weight += 1;
    left -= 1;
  }
  return out
    .filter((o) => o.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.i - b.i)
    .map(({ domain, weight }) => ({ domain, weight }));
}
