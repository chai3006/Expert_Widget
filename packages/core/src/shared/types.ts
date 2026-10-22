// Types shared by the main process and the renderer. Type-only plus small constant tables.

export const DOMAIN_IDS = [
  'automotive-emobility',
  'semiconductors',
  'embedded-iot',
  'industrial-automation',
  'energy-storage',
  'aerospace-defense',
  'machinery-household',
  'medtech',
  'rail-transport',
  'telecom',
  'software-ai',
  'civil-chemical',
] as const;

export type DomainId = (typeof DOMAIN_IDS)[number];

export const DOMAIN_LABELS: Record<DomainId, string> = {
  'automotive-emobility': 'Automotive & e-mobility',
  semiconductors: 'Semiconductors',
  'embedded-iot': 'Embedded & IoT',
  'industrial-automation': 'Industrial automation',
  'energy-storage': 'Energy & storage',
  'aerospace-defense': 'Aerospace & defence',
  'machinery-household': 'Machinery & household',
  medtech: 'Medtech',
  'rail-transport': 'Rail & transport',
  telecom: 'Telecom',
  'software-ai': 'Software & AI',
  'civil-chemical': 'Civil & chemical',
};

/** Short names for the one-line legend of the compact Domain mix card. */
export const DOMAIN_SHORT_LABELS: Record<DomainId, string> = {
  'automotive-emobility': 'Automotive',
  semiconductors: 'Semicon',
  'embedded-iot': 'Embedded',
  'industrial-automation': 'Automation',
  'energy-storage': 'Storage',
  'aerospace-defense': 'Aerospace',
  'machinery-household': 'Machinery',
  medtech: 'Medtech',
  'rail-transport': 'Rail',
  telecom: 'Telecom',
  'software-ai': 'Software',
  'civil-chemical': 'Civil/Chem',
};

export function isDomainId(value: unknown): value is DomainId {
  return typeof value === 'string' && (DOMAIN_IDS as readonly string[]).includes(value);
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
  setMode(mode: WindowMode): Promise<void>;
  /** The X button: hides the widget to the tray; it keeps running. */
  hideWindow(): Promise<void>;
  /** Manual dragging of the collapsed button (see main.ts for why -webkit-app-region is not used). */
  dragStart(): void;
  dragMove(): void;
  dragEnd(): void;
  onView(callback: (view: ViewModel) => void): () => void;
}
