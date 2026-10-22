// The news data shipped in data/: the signal words (data/news.json), the fixed broad search topics
// (data/news.json) and the source registry (data/sources.json). Validated here; read from disk by
// the Node layer.

import { SCORED_TAGS, dedupeCaseInsensitive, parseSource, stringList, type ScoredTag, type SourceConfig, type Validated } from './config.js';
import type { DomainRegistry } from './domains.js';

export const NEWS_SCHEMA_VERSION = 1;

/**
 * A broad search query, the same for every user. Search requests are built only from these and the
 * signal words, never from the CV; the results are filtered and ranked by the domain mix locally.
 */
export interface SearchTopic {
  id: string;
  label: string;
  /** Sectors of data/domains this topic covers (for SOURCES.md and tests). */
  sectors: string[];
  /** German search words for the sector (GDELT searches German-language sources in Germany). */
  keywords: string[];
}

export interface NewsData {
  topics: SearchTopic[];
  tags: Record<ScoredTag, string[]>;
  fairExclude: string[];
}

/** Everything in data/ the app needs besides the employer directory. */
export interface AppData {
  domains: DomainRegistry;
  news: NewsData;
  sources: SourceConfig[];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function validateNewsData(raw: unknown, registry: DomainRegistry): Validated<NewsData> {
  const errors: string[] = [];
  if (!isObject(raw)) return { ok: false, errors: ['news.json: the top level must be an object'] };
  if (raw.schemaVersion !== NEWS_SCHEMA_VERSION) errors.push(`news.json schemaVersion: must be ${NEWS_SCHEMA_VERSION}`);
  const topics: SearchTopic[] = [];
  if (!Array.isArray(raw.topics) || raw.topics.length === 0) {
    errors.push('news.json topics: must be a non-empty list');
  } else {
    const ids = new Set<string>();
    raw.topics.forEach((t, i) => {
      const p = `news.json topics[${i}]`;
      if (!isObject(t) || typeof t.id !== 'string' || !/^[a-z0-9-]+$/.test(t.id)) {
        errors.push(`${p}.id: must be lowercase letters, digits and dashes`);
        return;
      }
      if (ids.has(t.id)) errors.push(`${p}.id: "${t.id}" is used twice`);
      ids.add(t.id);
      const label = typeof t.label === 'string' ? t.label.trim() : '';
      if (!label) errors.push(`${p}.label: must be a non-empty string`);
      const sectors = stringList(t.sectors, `${p}.sectors`, errors);
      const keywords = stringList(t.keywords, `${p}.keywords`, errors);
      if (keywords.length === 0) errors.push(`${p}.keywords: must not be empty`);
      topics.push({ id: t.id, label, sectors, keywords });
    });
    // Every sector used by a domain is covered by a topic, so no field is left out of the searches.
    const covered = new Set(topics.flatMap((t) => t.sectors));
    for (const d of registry.recognisable) {
      if (!covered.has(d.sector)) errors.push(`news.json topics: no topic covers sector "${d.sector}" (domain ${d.id})`);
    }
  }
  const tags = {} as Record<ScoredTag, string[]>;
  if (!isObject(raw.tags)) {
    errors.push('news.json tags: must be an object with hiring_cuts, hiring_growth and funded_startup lists');
  } else {
    for (const tag of SCORED_TAGS) tags[tag] = dedupeCaseInsensitive(stringList(raw.tags[tag], `news.json tags.${tag}`, errors));
    for (const key of Object.keys(raw.tags)) if (!(SCORED_TAGS as string[]).includes(key)) errors.push(`news.json tags: unknown tag "${key}"`);
  }
  const fairExclude = raw.fairExclude === undefined ? [] : stringList(raw.fairExclude, 'news.json fairExclude', errors);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { topics, tags, fairExclude } };
}

export function validateSourceRegistry(raw: unknown, registry: DomainRegistry): Validated<SourceConfig[]> {
  const errors: string[] = [];
  if (!isObject(raw) || raw.schemaVersion !== NEWS_SCHEMA_VERSION || !Array.isArray(raw.sources)) {
    return { ok: false, errors: [`sources.json: must be { "schemaVersion": ${NEWS_SCHEMA_VERSION}, "sources": [...] }`] };
  }
  const out: SourceConfig[] = [];
  const ids = new Set<string>();
  raw.sources.forEach((s, i) => {
    const src = parseSource(s, `sources.json sources[${i}]`, errors, registry);
    if (!src) return;
    if (ids.has(src.id)) errors.push(`sources.json sources[${i}].id: "${src.id}" is used twice`);
    ids.add(src.id);
    out.push(src);
  });
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: out };
}
