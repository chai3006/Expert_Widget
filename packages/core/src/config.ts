// Loading and validation of config.json, employers.json and watchlist.json. Validation collects every problem with
// its exact JSON path so the error screen can tell the user precisely what to fix.

import type { DomainRegistry } from './domains.js';
import type { DomainId } from './shared/types.js';
import { isValidHotkey } from './hotkey.js';

export const SOURCE_TOPICS = ['hiring', 'funded_startup', 'career_fair'] as const;
export type SourceTopic = (typeof SOURCE_TOPICS)[number];

export const ADAPTER_IDS = ['rss', 'ingenieur-recruiting-tag', 'messen-de', 'eurofound-erm', 'produktion-de'] as const;
export type AdapterId = (typeof ADAPTER_IDS)[number];

export type ScoredTag = 'hiring_growth' | 'hiring_cuts' | 'funded_startup';
const SCORED_TAGS: ScoredTag[] = ['hiring_cuts', 'hiring_growth', 'funded_startup'];

export interface SourceConfig {
  id: string;
  topic: SourceTopic;
  name: string;
  url: string;
  adapter: AdapterId;
  enabled: boolean;
  domains: 'all' | DomainId[];
}

/** How the CV is read (see the README, "How the domain mix is computed"). */
export interface CvAnalysisConfig {
  /** Years after which an old role counts half as much as the current one. */
  halfLifeYears: number;
  /** Extra weight of the current or most recent role. */
  currentRoleBoost: number;
  /** More words to ignore in every field, on top of the built-in list (e.g. "Projekt", "Team"). */
  ignoreWords: string[];
}

export const DEFAULT_CV_ANALYSIS: CvAnalysisConfig = { halfLifeYears: 5, currentRoleBoost: 1.5, ignoreWords: [] };

export interface AppConfig {
  /** The domain registry the config was validated against (data/domains). */
  domains: DomainRegistry;
  cvFolder: string;
  cvAnalysis: CvAnalysisConfig;
  newsMaxAgeDays: number;
  maxItemsPerTag: number;
  /** Global show/hide hotkey, e.g. "CommandOrControl+Alt+E"; "" switches it off. */
  hotkey: string;
  sources: SourceConfig[];
  /** Search providers (layers 2 and 3). */
  search: {
    gdelt: { enabled: boolean; maxRecords: number };
    googleNews: { enabled: boolean };
  };
  keywords: {
    /**
     * Keywords per domain: the registry's keywords plus any extra ones from config.json, in
     * registry order (the tie-break order). Used to classify news and by the keyword-only profiler.
     */
    domains: Partial<Record<DomainId, string[]>>;
    tags: Record<ScoredTag, string[]>;
    fairExclude: string[];
  };
}

export interface CompanyEntry {
  name: string;
  careerUrl: string;
  lastVerified: string;
}

export interface EmployerSegment {
  domain: DomainId;
  segment: string;
  companies: CompanyEntry[];
}

/** A company the user keeps an eye on (watchlist.json). Not filtered by the CV domain mix. */
export interface WatchlistEntry {
  name: string;
  /** "" until the user fills it in; the chip then says "no link". */
  website: string;
  note: string;
  /** yyyy-mm-dd or "". */
  addedAt: string;
  /** yyyy-mm-dd of the last successful `npm run check-links`, or "". */
  lastVerified: string;
}

// CommandOrControl is Ctrl on Windows and Linux and Cmd on macOS.
export const DEFAULT_HOTKEY = 'CommandOrControl+Alt+E';

export type Validated<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Parses JSON and reports syntax errors with a line number where possible. */
export function parseJson(text: string, fileName: string): Validated<unknown> {
  try {
    return { ok: true, value: JSON.parse(text.replace(/^\uFEFF/, '')) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const pos = /position (\d+)/.exec(message);
    if (pos) {
      const line = text.slice(0, Number(pos[1])).split('\n').length;
      return { ok: false, errors: [`${fileName} is not valid JSON (line ${line}): ${message}`] };
    }
    return { ok: false, errors: [`${fileName} is not valid JSON: ${message}`] };
  }
}

function stringList(value: unknown, path: string, errors: string[]): string[] {
  if (!Array.isArray(value)) {
    errors.push(`${path}: must be a list of strings`);
    return [];
  }
  const out: string[] = [];
  value.forEach((v, i) => {
    if (typeof v !== 'string' || v.trim() === '') errors.push(`${path}[${i}]: must be a non-empty string`);
    else out.push(v.trim());
  });
  return out;
}

export function validateConfig(raw: unknown, registry: DomainRegistry): Validated<AppConfig> {
  const errors: string[] = [];
  if (!isObject(raw)) return { ok: false, errors: ['config.json: the top level must be an object { ... }'] };

  // "" (or the old default) means the CV folder next to config.json, in the Documents folder.
  if (typeof raw.cvFolder !== 'string') {
    errors.push('cvFolder: must be a folder path, or "" for the default');
  }
  if (!Number.isInteger(raw.newsMaxAgeDays) || (raw.newsMaxAgeDays as number) < 1 || (raw.newsMaxAgeDays as number) > 365) {
    errors.push('newsMaxAgeDays: must be a whole number between 1 and 365');
  }
  const maxItemsPerTag = raw.maxItemsPerTag ?? 12;
  if (!Number.isInteger(maxItemsPerTag) || (maxItemsPerTag as number) < 1 || (maxItemsPerTag as number) > 100) {
    errors.push('maxItemsPerTag: must be a whole number between 1 and 100');
  }

  const hotkey = raw.hotkey ?? DEFAULT_HOTKEY;
  if (typeof hotkey !== 'string' || (hotkey.trim() !== '' && !isValidHotkey(hotkey.trim()))) {
    errors.push('hotkey: must be a key combination like "CommandOrControl+Alt+E" (modifiers CommandOrControl, Ctrl, Alt, Shift, Cmd, then one key), or "" for none');
  }

  const sources: SourceConfig[] = [];
  if (!Array.isArray(raw.sources)) {
    errors.push('sources: must be a list');
  } else {
    const ids = new Set<string>();
    raw.sources.forEach((s, i) => {
      const p = `sources[${i}]`;
      if (!isObject(s)) {
        errors.push(`${p}: must be an object`);
        return;
      }
      const before = errors.length;
      if (typeof s.id !== 'string' || !/^[a-z0-9-]+$/.test(s.id)) errors.push(`${p}.id: must be lowercase letters, digits and dashes`);
      else if (ids.has(s.id)) errors.push(`${p}.id: "${s.id}" is used twice`);
      else ids.add(s.id);
      if (!(SOURCE_TOPICS as readonly unknown[]).includes(s.topic)) errors.push(`${p}.topic: must be one of ${SOURCE_TOPICS.join(', ')}`);
      if (typeof s.name !== 'string' || s.name.trim() === '') errors.push(`${p}.name: must be a non-empty string`);
      if (!isHttpUrl(s.url)) errors.push(`${p}.url: must be an http or https URL`);
      if (!(ADAPTER_IDS as readonly unknown[]).includes(s.adapter)) errors.push(`${p}.adapter: must be one of ${ADAPTER_IDS.join(', ')}`);
      if (typeof s.enabled !== 'boolean') errors.push(`${p}.enabled: must be true or false`);
      let domains: 'all' | DomainId[] = 'all';
      if (Array.isArray(s.domains)) {
        domains = [];
        s.domains.forEach((d, j) => {
          if (typeof d === 'string' && registry.has(d)) (domains as DomainId[]).push(d);
          else errors.push(`${p}.domains[${j}]: unknown domain "${String(d)}"`);
        });
      } else if (s.domains !== 'all') {
        errors.push(`${p}.domains: must be "all" or a list of domain ids`);
      }
      if (errors.length === before) {
        sources.push({
          id: s.id as string,
          topic: s.topic as SourceTopic,
          name: (s.name as string).trim(),
          url: s.url as string,
          adapter: s.adapter as AdapterId,
          enabled: s.enabled as boolean,
          domains,
        });
      }
    });
  }

  const search: AppConfig['search'] = { gdelt: { enabled: true, maxRecords: 75 }, googleNews: { enabled: false } };
  if (raw.search !== undefined) {
    if (!isObject(raw.search)) {
      errors.push('search: must be an object with "gdelt" and "googleNews"');
    } else {
      for (const key of Object.keys(raw.search)) {
        if (key !== 'gdelt' && key !== 'googleNews') errors.push(`search: unknown provider "${key}" (known: gdelt, googleNews)`);
      }
      const g = raw.search.gdelt;
      if (g !== undefined) {
        if (!isObject(g)) errors.push('search.gdelt: must be an object');
        else {
          if (g.enabled !== undefined && typeof g.enabled !== 'boolean') errors.push('search.gdelt.enabled: must be true or false');
          else if (typeof g.enabled === 'boolean') search.gdelt.enabled = g.enabled;
          if (g.maxRecords !== undefined && (!Number.isInteger(g.maxRecords) || (g.maxRecords as number) < 1 || (g.maxRecords as number) > 75)) {
            errors.push('search.gdelt.maxRecords: must be a whole number between 1 and 75');
          } else if (g.maxRecords !== undefined) search.gdelt.maxRecords = g.maxRecords as number;
        }
      }
      const n = raw.search.googleNews;
      if (n !== undefined) {
        if (!isObject(n)) errors.push('search.googleNews: must be an object');
        else if (n.enabled !== undefined && typeof n.enabled !== 'boolean') errors.push('search.googleNews.enabled: must be true or false');
        else if (typeof n.enabled === 'boolean') search.googleNews.enabled = n.enabled;
      }
    }
  }

  const extraKeywords: Partial<Record<DomainId, string[]>> = {};
  const tagKeywords = {} as Record<ScoredTag, string[]>;
  let fairExclude: string[] = [];
  if (!isObject(raw.keywords)) {
    errors.push('keywords: must be an object with "tags"');
  } else {
    const kw = raw.keywords;
    // Optional extra keywords per domain; the domain files in data/domains hold the real lists.
    if (kw.domains !== undefined && !isObject(kw.domains)) {
      errors.push('keywords.domains: must be an object mapping domain ids to extra keyword lists');
    } else if (isObject(kw.domains)) {
      for (const [domain, list] of Object.entries(kw.domains)) {
        if (!registry.has(domain)) {
          errors.push(`keywords.domains: unknown domain "${domain}". Known domains: ${registry.ids.join(', ')}`);
          continue;
        }
        extraKeywords[domain] = stringList(list, `keywords.domains.${domain}`, errors);
      }
    }
    if (!isObject(kw.tags)) {
      errors.push('keywords.tags: must be an object with hiring_growth, hiring_cuts and funded_startup lists');
    } else {
      for (const tag of SCORED_TAGS) {
        if (kw.tags[tag] === undefined) errors.push(`keywords.tags.${tag}: missing`);
        else tagKeywords[tag] = dedupeCaseInsensitive(stringList(kw.tags[tag], `keywords.tags.${tag}`, errors));
      }
      for (const key of Object.keys(kw.tags)) {
        if (!(SCORED_TAGS as string[]).includes(key)) errors.push(`keywords.tags: unknown tag "${key}"`);
      }
    }
    if (kw.fairExclude !== undefined) fairExclude = stringList(kw.fairExclude, 'keywords.fairExclude', errors);
  }

  const cvAnalysis = validateCvAnalysis(raw.cvAnalysis, errors);

  if (errors.length > 0) return { ok: false, errors };
  const domainKeywords: Partial<Record<DomainId, string[]>> = {};
  for (const d of registry.recognisable) {
    domainKeywords[d.id] = dedupeCaseInsensitive([...d.keywords.map((k) => k.term), ...(extraKeywords[d.id] ?? [])]);
  }
  return {
    ok: true,
    value: {
      domains: registry,
      cvFolder: (raw.cvFolder as string).trim(),
      cvAnalysis,
      newsMaxAgeDays: raw.newsMaxAgeDays as number,
      maxItemsPerTag: maxItemsPerTag as number,
      hotkey: (hotkey as string).trim(),
      sources,
      search,
      keywords: { domains: domainKeywords, tags: tagKeywords, fairExclude },
    },
  };
}

function dedupeCaseInsensitive(list: string[]): string[] {
  const seen = new Set<string>();
  return list.filter((k) => {
    const key = k.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function validateCvAnalysis(raw: unknown, errors: string[]): CvAnalysisConfig {
  if (raw === undefined) return { ...DEFAULT_CV_ANALYSIS };
  if (!isObject(raw)) {
    errors.push('cvAnalysis: must be an object');
    return { ...DEFAULT_CV_ANALYSIS };
  }
  const out = { ...DEFAULT_CV_ANALYSIS };
  if (raw.halfLifeYears !== undefined) {
    if (typeof raw.halfLifeYears !== 'number' || raw.halfLifeYears < 0.5 || raw.halfLifeYears > 50) errors.push('cvAnalysis.halfLifeYears: must be a number between 0.5 and 50');
    else out.halfLifeYears = raw.halfLifeYears;
  }
  if (raw.currentRoleBoost !== undefined) {
    if (typeof raw.currentRoleBoost !== 'number' || raw.currentRoleBoost < 1 || raw.currentRoleBoost > 5) errors.push('cvAnalysis.currentRoleBoost: must be a number between 1 and 5');
    else out.currentRoleBoost = raw.currentRoleBoost;
  }
  if (raw.ignoreWords !== undefined) out.ignoreWords = stringList(raw.ignoreWords, 'cvAnalysis.ignoreWords', errors);
  for (const key of Object.keys(raw)) {
    if (!['halfLifeYears', 'currentRoleBoost', 'ignoreWords'].includes(key)) errors.push(`cvAnalysis: unknown setting "${key}"`);
  }
  return out;
}

/** Domain order used for tie-breaks: the registry order (data/domains, field "order"). */
export function domainOrder(config: AppConfig): DomainId[] {
  return config.domains.ids;
}

export function validateEmployers(raw: unknown, registry: DomainRegistry): Validated<EmployerSegment[]> {
  const errors: string[] = [];
  if (!isObject(raw) || !Array.isArray(raw.segments)) {
    return { ok: false, errors: ['employers.json: the top level must be an object with a "segments" list'] };
  }
  const segments: EmployerSegment[] = [];
  raw.segments.forEach((s, i) => {
    const p = `employers.json segments[${i}]`;
    if (!isObject(s)) {
      errors.push(`${p}: must be an object`);
      return;
    }
    const before = errors.length;
    if (typeof s.domain !== 'string' || !registry.has(s.domain)) errors.push(`${p}.domain: unknown domain "${String(s.domain)}"`);
    if (typeof s.segment !== 'string' || s.segment.trim() === '') errors.push(`${p}.segment: must be a non-empty string`);
    const companies: CompanyEntry[] = [];
    if (!Array.isArray(s.companies)) {
      errors.push(`${p}.companies: must be a list`);
    } else {
      s.companies.forEach((c, j) => {
        const cp = `${p}.companies[${j}]`;
        if (!isObject(c)) {
          errors.push(`${cp}: must be an object`);
          return;
        }
        if (typeof c.name !== 'string' || c.name.trim() === '') errors.push(`${cp}.name: must be a non-empty string`);
        if (!isHttpUrl(c.careerUrl)) errors.push(`${cp}.careerUrl: must be an http or https URL`);
        const lv = c.lastVerified ?? '';
        if (typeof lv !== 'string' || (lv !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(lv))) {
          errors.push(`${cp}.lastVerified: must be empty or a date like 2026-10-10`);
        }
        if (typeof c.name === 'string' && isHttpUrl(c.careerUrl) && typeof lv === 'string') {
          companies.push({ name: c.name.trim(), careerUrl: c.careerUrl, lastVerified: lv });
        }
      });
    }
    if (errors.length === before) {
      segments.push({ domain: s.domain as DomainId, segment: (s.segment as string).trim(), companies });
    }
  });
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: segments };
}

const isDayOrEmpty = (v: unknown) => typeof v === 'string' && (v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v));

export function validateWatchlist(raw: unknown): Validated<WatchlistEntry[]> {
  if (!isObject(raw) || !Array.isArray(raw.companies)) {
    return { ok: false, errors: ['watchlist.json: the top level must be an object with a "companies" list'] };
  }
  const errors: string[] = [];
  const names = new Set<string>();
  const entries: WatchlistEntry[] = [];
  raw.companies.forEach((c, i) => {
    const p = `watchlist.json companies[${i}]`;
    if (!isObject(c)) {
      errors.push(`${p}: must be an object`);
      return;
    }
    const before = errors.length;
    const name = typeof c.name === 'string' ? c.name.trim() : '';
    if (name === '') errors.push(`${p}.name: must be a non-empty string`);
    else if (names.has(name.toLowerCase())) errors.push(`${p}.name: "${name}" is listed twice`);
    else names.add(name.toLowerCase());
    const website = c.website ?? '';
    if (typeof website !== 'string' || (website.trim() !== '' && !isHttpUrl(website.trim()))) {
      errors.push(`${p}.website: must be empty or an http or https URL`);
    }
    const note = c.note ?? '';
    if (typeof note !== 'string') errors.push(`${p}.note: must be a string`);
    for (const key of ['addedAt', 'lastVerified'] as const) {
      if (!isDayOrEmpty(c[key] ?? '')) errors.push(`${p}.${key}: must be empty or a date like 2026-10-11`);
    }
    if (errors.length === before) {
      entries.push({
        name,
        website: (website as string).trim(),
        note: (note as string).trim(),
        addedAt: (c.addedAt as string | undefined) ?? '',
        lastVerified: (c.lastVerified as string | undefined) ?? '',
      });
    }
  });
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: entries };
}

/**
 * Turns the cvFolder setting into a path for this computer. Understands "~" (the home folder),
 * $VAR / ${VAR} (macOS and Linux style) and %VAR% (Windows style). %USERPROFILE% falls back to
 * the home folder where it is not set, and backslashes become slashes outside Windows, so a
 * config.json written on Windows still works on a Mac or Linux PC.
 */
export function expandPath(path: string, env: Record<string, string | undefined>, homeDir: string, platform: string): string {
  let out = expandEnvVars(path, { USERPROFILE: homeDir, ...env });
  if (platform !== 'win32') {
    out = out
      .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, braced?: string, bare?: string) => env[braced ?? bare ?? ''] ?? match)
      .replace(/\\/g, '/');
  }
  if (out === '~') return homeDir;
  if (out.startsWith('~/') || out.startsWith('~\\')) return homeDir + out.slice(1);
  return out;
}

/** Expands %VAR% references (Windows style) using the given environment. */
export function expandEnvVars(path: string, env: Record<string, string | undefined>): string {
  return path.replace(/%([^%]+)%/g, (match, name: string) => {
    const key = Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase());
    return key !== undefined && env[key] !== undefined ? (env[key] as string) : match;
  });
}

export const GDELT_PROVIDER_ID = 'gdelt';
export const GOOGLE_NEWS_PROVIDER_ID = 'google-news';

export interface ProviderInfo {
  id: string;
  name: string;
  layer: 1 | 2 | 3;
  topic: SourceTopic;
  domains: 'all' | DomainId[];
}

/** The enabled providers in priority order: the sources' own feeds, then GDELT, then Google News. */
export function enabledProviders(config: AppConfig): ProviderInfo[] {
  const list: ProviderInfo[] = config.sources
    .filter((s) => s.enabled)
    .map((s) => ({ id: s.id, name: s.name, layer: 1, topic: s.topic, domains: s.domains }));
  if (config.search.gdelt.enabled) list.push({ id: GDELT_PROVIDER_ID, name: 'GDELT news search', layer: 2, topic: 'hiring', domains: 'all' });
  if (config.search.googleNews.enabled) list.push({ id: GOOGLE_NEWS_PROVIDER_ID, name: 'Google News search', layer: 3, topic: 'hiring', domains: 'all' });
  return list;
}
