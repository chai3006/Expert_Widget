// The polite fetcher's cache as JSON files: <dir>/http/<sha1(url)>.json and
// <dir>/robots/<sha1(origin)>.json. A damaged file counts as a cache miss.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CachedResponse, CachedRobots, HttpCache } from '../../core/src/ports.js';
import { writeJsonAtomic } from './state/jsonStore.js';

function hash(s: string): string {
  return createHash('sha1').update(s).digest('hex');
}

function readJson<T>(file: string): T | null {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

export class DiskHttpCache implements HttpCache {
  constructor(readonly dir: string) {}

  getResponse(url: string): CachedResponse | null {
    return readJson<CachedResponse>(join(this.dir, 'http', `${hash(url)}.json`));
  }

  setResponse(url: string, entry: CachedResponse): void {
    writeJsonAtomic(join(this.dir, 'http', `${hash(url)}.json`), entry);
  }

  getRobots(origin: string): CachedRobots | null {
    return readJson<CachedRobots>(join(this.dir, 'robots', `${hash(origin)}.json`));
  }

  setRobots(origin: string, entry: CachedRobots): void {
    writeJsonAtomic(join(this.dir, 'robots', `${hash(origin)}.json`), entry);
  }
}
