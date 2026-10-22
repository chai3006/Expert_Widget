// The data shipped with the app (data/ in the repository and the installed app): the domain
// registry and, from Phase 4 on, the employer directory. Read once at start; a broken file is a
// configuration error with the file name, like a broken config.json.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DomainRegistry, type Validated } from '../../core/src/domains.js';

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
