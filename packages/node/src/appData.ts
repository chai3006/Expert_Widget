// The data shipped with the app (data/ in the repository and the installed app): the domain
// registry, the news rules and the source registry. Read on every Refresh, like config.json; a
// broken file is a configuration error with the file name.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DomainRegistry, type Validated } from '../../core/src/domains.js';
import { validateNewsData, validateSourceRegistry, type AppData } from '../../core/src/newsData.js';

/** The app or repository root: the nearest folder upwards that has defaults/config.json. */
export function findAppRoot(start = __dirname): string {
  for (let d = start; ; d = dirname(d)) {
    if (existsSync(join(d, 'defaults', 'config.json'))) return d;
    if (dirname(d) === d) throw new Error('cannot find the app folder (defaults/config.json)');
  }
}

/** Reads every data/domains/<id>.json and builds the registry. */
export function loadDomainRegistry(domainsDir: string): Validated<DomainRegistry> {
  let names: string[];
  try {
    names = readdirSync(domainsDir).filter((n) => n.endsWith('.json')).sort();
  } catch (err) {
    return { ok: false, errors: [`Cannot read the domain folder ${domainsDir}: ${err instanceof Error ? err.message : String(err)}`] };
  }
  const files: Array<{ id: string; raw: unknown }> = [];
  const errors: string[] = [];
  for (const name of names) {
    try {
      files.push({ id: name.slice(0, -'.json'.length), raw: JSON.parse(readFileSync(join(domainsDir, name), 'utf8').replace(/^﻿/, '')) });
    } catch (err) {
      errors.push(`${name} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return DomainRegistry.fromRaw(files);
}

function readJson(path: string): Validated<unknown> {
  try {
    return { ok: true, value: JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')) };
  } catch (err) {
    return { ok: false, errors: [`Cannot read ${path}: ${err instanceof Error ? err.message : String(err)}`] };
  }
}

/** data/domains/*.json, data/news.json and data/sources.json. */
export function loadAppData(dataDir: string): Validated<AppData> {
  const domains = loadDomainRegistry(join(dataDir, 'domains'));
  if (!domains.ok) return domains;
  const newsRaw = readJson(join(dataDir, 'news.json'));
  if (!newsRaw.ok) return newsRaw;
  const news = validateNewsData(newsRaw.value, domains.value);
  if (!news.ok) return news;
  const sourcesRaw = readJson(join(dataDir, 'sources.json'));
  if (!sourcesRaw.ok) return sourcesRaw;
  const sources = validateSourceRegistry(sourcesRaw.value, domains.value);
  if (!sources.ok) return sources;
  return { ok: true, value: { domains: domains.value, news: news.value, sources: sources.value } };
}
