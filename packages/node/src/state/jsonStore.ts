// Small JSON file store: atomic writes (temp file + rename) and corrupt-file recovery
// (the bad file is kept as <name>.corrupt-<timestamp>.json and the store starts fresh).

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

export type Sanitizer<T> = (raw: unknown) => T | null;

export interface LoadResult<T> {
  value: T;
  /** Set when an unreadable file was moved aside. */
  recoveredFrom?: string;
}

export function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  // Windows can briefly lock the target (antivirus, indexer). Retry a few times before giving up.
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(tmp, path);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt < 5 && (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES')) {
        const until = Date.now() + 50 * (attempt + 1);
        while (Date.now() < until) {
          /* short synchronous back-off */
        }
        continue;
      }
      try {
        unlinkSync(tmp);
      } catch {
        /* ignore */
      }
      throw err;
    }
  }
}

export function loadJson<T>(path: string, fallback: () => T, sanitize: Sanitizer<T>, now = Date.now()): LoadResult<T> {
  if (!existsSync(path)) return { value: fallback() };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    parsed = undefined;
  }
  const value = parsed === undefined ? null : sanitize(parsed);
  if (value !== null) return { value };

  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-');
  const backup = join(dirname(path), `${basename(path, '.json')}.corrupt-${stamp}.json`);
  try {
    renameSync(path, backup);
  } catch {
    /* if even the rename fails, starting fresh in memory is still the safe choice */
  }
  return { value: fallback(), recoveredFrom: backup };
}

/** A typed JSON file kept in memory and written through on every change. */
export class JsonStore<T> {
  private current: T;
  readonly recoveredFrom?: string;

  constructor(
    readonly path: string,
    private readonly fallback: () => T,
    sanitize: Sanitizer<T>,
  ) {
    const loaded = loadJson(path, fallback, sanitize);
    this.current = loaded.value;
    this.recoveredFrom = loaded.recoveredFrom;
  }

  get value(): T {
    return this.current;
  }

  set(value: T): void {
    this.current = value;
    writeJsonAtomic(this.path, value);
  }

  update(change: (draft: T) => T): void {
    this.set(change(this.current));
  }
}
