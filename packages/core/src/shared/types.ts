// Types shared by the main process and the renderer. Type-only plus small constant tables.

/** A domain id from the registry (data/domains/<id>.json), e.g. "healthcare-nursing". */
export type DomainId = string;

const DOMAIN_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** True for a well-formed domain id. Whether the domain exists is the registry's business. */
export function isDomainId(value: unknown): value is DomainId {
  return typeof value === 'string' && value !== 'all' && DOMAIN_ID_PATTERN.test(value);
}

/** A domain as the UI lists it (all registry domains, for labels and the manual domain editor). */
export interface DomainOption {
  id: DomainId;
  label: string;
  shortLabel: string;
}

/** Domain of a news item: a specific domain, or `all` when no domain keyword matched. */
export type ItemDomain = DomainId | 'all';

export const NEWS_TAGS = ['hiring_growth', 'hiring_cuts', 'funded_startup', 'career_fair'] as const;
export type NewsTag = (typeof NEWS_TAGS)[number];

export const TAG_LABELS: Record<NewsTag, string> = {
  hiring_growth: 'Hiring signal · growth',
  hiring_cuts: 'Hiring signal · cuts',
  funded_startup: 'Funded startup',
  career_fair: 'Career fair',
};

/** Filter chips in the news section. `hiring` covers both growth and cuts. */
export type NewsFilter = 'all' | 'hiring' | 'funded_startup' | 'career_fair';

export function tagMatchesFilter(tag: NewsTag, filter: NewsFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'hiring') return tag === 'hiring_growth' || tag === 'hiring_cuts';
  return tag === filter;
}

export type Theme = 'day' | 'dark';

export interface DomainWeight {
  domain: DomainId;
  /** Whole-number percentage; all weights of a profile sum to 100. */
  weight: number;
}

/** One reason a domain is in the mix (see contracts/DomainProfile). Labels are registry terms, never CV text. */
export interface DomainEvidenceView {
  domain: DomainId;
  label: string;
  kind: 'title' | 'education' | 'certification' | 'skill' | 'keyword';
  period: string | null;
  current: boolean;
}

/** The only thing stored about the CV: never the text itself. */
export interface CvProfile {
  fileName: string;
  modifiedMs: number;
  /** File size when read; with name and modified time it tells a replaced CV apart. */
  sizeBytes?: number;
  weights: DomainWeight[];
  computedAt: number;
  /** auto (computed), manual (set by the user) or fallback (general domain). Missing means auto. */
  source?: 'auto' | 'manual' | 'fallback';
  evidence?: DomainEvidenceView[];
  /** Plain-language note for a fallback profile. */
  notice?: string | null;
}

export interface CompanyChip {
  key: string;
  name: string;
  careerUrl: string;
  visitedAt: number | null;
}

/** A watchlist company. `website` is null until the user fills it in (the chip says "no link"). */
export interface WatchlistChip {
  /** Key for the visited state, kept apart from the employers' keys. */
  key: string;
  name: string;
  website: string | null;
  note: string;
  visitedAt: number | null;
  /** New (unseen) cards in the News feed that mention this company. */
  newsCount: number;
}

export interface EmployerSegmentView {
  segment: string;
  companies: CompanyChip[];
}

export interface EmployerDomainView {
  domain: DomainId;
  label: string;
  weight: number;
  /** Empty when employers.json has nothing for this domain; the UI then shows a note. */
  segments: EmployerSegmentView[];
}

export interface NewsCard {
  id: string;
  tag: NewsTag;
  headline: string;
  summary: string;
  url: string;
  sourceName: string;
  domain: ItemDomain;
  domainLabel: string;
  /** ISO timestamp of publication (or first sighting), used for ordering. */
  date: string;
  /** Career fairs only: ISO date (yyyy-mm-dd) of the event, or null when "date to be confirmed". */
  eventDate: string | null;
  eventEndDate: string | null;
  seenAt: number | null;
  /** Thumbs up: kept on every Refresh and exempt from expiry. */
  useful: boolean;
  /** English translation made on this PC, when the original is German. */
  translated: { headline: string | null; summary: string | null } | null;
  /** Watchlist companies the card mentions; such cards come first and skip the domain mix. */
  watchlist: string[];
  /** Watchlist and employer-directory companies the card names (for company signals). */
  companies?: string[];
}

export type WindowMode = 'collapsed' | 'expanded';

/** Result of a provider's last Refresh. `unchecked`: not run yet (for example, no domain mix). */
export type ProviderStatus = 'ok' | 'empty' | 'failed' | 'unchecked';

export interface ProviderHealthView {
  id: string;
  name: string;
  /** 1: source feeds and pages, 2: GDELT, 3: Google News. */
  layer: 1 | 2 | 3;
  status: ProviderStatus;
  checkedAt: number | null;
  itemCount: number;
  /** Error text for a failed provider, or a note such as "not needed this time". */
  detail: string | null;
  /** Failed three Refreshes in a row. */
  needsAttention: boolean;
}

export interface SourceHealthView {
  /** Providers whose last Refresh did not fail. */
  working: number;
  total: number;
  providers: ProviderHealthView[];
}

export type MessageLevel = 'info' | 'warning' | 'error';

export interface StatusMessage {
  level: MessageLevel;
  text: string;
}

/** The data the widget shows: the same for any front end (widget, Expert page, CLI). */
export interface ExpertData {
  lastUpdated: number | null;
  /** Every domain of the registry in registry order, for labels and choosing domains by hand. */
  domains: DomainOption[];
  profile: CvProfile | null;
  employers: EmployerDomainView[];
  watchlist: WatchlistChip[];
  news: NewsCard[];
  sourceHealth: SourceHealthView;
}

/** How the data is shown right now: theme, window mode, messages, refresh state. */
export interface UiView {
  mock: boolean;
  /** When set, the UI shows only an error screen with this text. */
  configError: string | null;
  theme: Theme;
  refreshing: boolean;
  messages: StatusMessage[];
  cvFolder: string;
  /** Problem with the CV folder or file (none, several, unreadable). */
  cvStatus: StatusMessage | null;
  /** The kind of that problem, for the welcome screen's help (see CvProblemKind in ports.ts). */
  cvProblemKind: string | null;
  /** win32, darwin, linux, or web for the Expert page; decides words such as "tray" or "menu bar". */
  platform: string;
  /** What this front end can do: open or choose the CV folder (desktop only). */
  canManageFolder: boolean;
  /** Watchlist company names are searched in the news (the only user-chosen terms sent). */
  watchlistSearch: boolean;
  /** Unseen cards in the feed (removed ones are never in it); shown on the collapsed button. */
  unseenCount: number;
  mode: WindowMode;
  /** True once at least one refresh has produced a profile or news. */
  hasData: boolean;
}

export interface ViewModel {
  ui: UiView;
  data: ExpertData;
}

/** The API the preload script exposes to the renderer as `window.expert`. */
export interface ExpertApi {
  getView(): Promise<ViewModel>;
  refresh(): Promise<ViewModel>;
  markVisited(companyKey: string): Promise<void>;
  markSeen(newsId: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  /** Thumbs down: hides the card for good (by canonical URL). */
  removeNews(newsId: string): Promise<void>;
  undoRemove(newsId: string): Promise<ViewModel>;
  /** Thumbs up, or undo it when already set. */
  toggleUseful(newsId: string): Promise<ViewModel>;
  setTheme(theme: Theme): Promise<void>;
  /** Choose the domains by hand (1 to 4, shares in any unit); replaces the automatic mix. */
  setManualDomains(weights: DomainWeight[]): Promise<ViewModel>;
  /** Back to the domain mix computed from the CV. */
  clearManualDomains(): Promise<ViewModel>;
  /** Opens the CV folder in Explorer, Finder or the file manager (desktop only). */
  openCvFolder(): Promise<void>;
  /** Lets the user pick another CV folder (desktop only); refreshes when one was chosen. */
  chooseCvFolder(): Promise<ViewModel>;
  /** Switches searching the news for watchlist company names on or off. */
  setWatchlistSearch(on: boolean): Promise<ViewModel>;
  setMode(mode: WindowMode): Promise<void>;
  /** The X button: hides the widget to the tray; it keeps running. */
  hideWindow(): Promise<void>;
  /** Manual dragging of the collapsed button (see main.ts for why -webkit-app-region is not used). */
  dragStart(): void;
  dragMove(): void;
  dragEnd(): void;
  onView(callback: (view: ViewModel) => void): () => void;
}
