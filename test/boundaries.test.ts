// The package boundaries: the core stays free of Electron, Node, files, network and the DOM, so it
// can run in a dashboard backend or a browser. tsconfig.core.json checks the same with types.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { base64ToLatin1, sha1Hex } from '../packages/core/src/hash.js';
import { ROOT } from './helpers/config.js';

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? tsFiles(p) : p.endsWith('.ts') ? [p] : [];
  });
}

function importsOf(source: string): string[] {
  return [...source.matchAll(/(?:^|\n)\s*(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g)].map(
    (m) => m[1] ?? m[2] ?? m[3],
  );
}

/** Source without comments and string literals, to look for global names. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, "''");
}

const CORE = join(ROOT, 'packages', 'core', 'src');
const UI = join(ROOT, 'packages', 'ui', 'src');
const ALLOWED_CORE_PACKAGES = ['cheerio/slim'];
// Global names only (not `.fetch(` member calls). `npm run typecheck` (tsconfig.core.json, no Node
// or DOM types) catches the rest, such as a global fetch().
const FORBIDDEN_GLOBALS = /(?<![.\w$])(document|window|localStorage|sessionStorage|navigator|process|Buffer|__dirname|__filename|require|XMLHttpRequest|setInterval)\b(?!\s*\??:)/;

describe('package boundaries', () => {
  const coreFiles = tsFiles(CORE);

  it('finds the core sources', () => {
    expect(coreFiles.length).toBeGreaterThan(20);
  });

  it.each(coreFiles.map((f) => [relative(ROOT, f), f]))('core file %s imports only the core and pure libraries', (_name, file) => {
    for (const spec of importsOf(readFileSync(file, 'utf8'))) {
      if (spec.startsWith('.')) {
        const target = resolve(dirname(file), spec);
        expect(target.startsWith(CORE + sep), `${spec} leaves packages/core`).toBe(true);
      } else {
        expect(ALLOWED_CORE_PACKAGES, `${spec} is not allowed in the core (no electron, fs, path, network or native modules)`).toContain(spec);
      }
    }
  });

  it.each(coreFiles.map((f) => [relative(ROOT, f), f]))('core file %s uses no Node, DOM or network globals', (_name, file) => {
    const found = FORBIDDEN_GLOBALS.exec(codeOnly(readFileSync(file, 'utf8')));
    expect(found?.[0] ?? null).toBeNull();
  });

  it('the UI imports only the shared types and helpers of the core', () => {
    for (const file of tsFiles(UI)) {
      for (const spec of importsOf(readFileSync(file, 'utf8'))) {
        expect(spec.startsWith('.'), `${spec} in ${relative(ROOT, file)}`).toBe(true);
        const target = resolve(dirname(file), spec);
        const ok = target.startsWith(UI + sep) || target.startsWith(join(CORE, 'shared') + sep);
        expect(ok, `${spec} in ${relative(ROOT, file)}`).toBe(true);
      }
    }
  });
});

describe('pure hash helpers', () => {
  it.each(['', 'abc', 'https://example.com/a?b=1', 'Stellenabbau bei Zulieferer – 1.200 Jobs', 'x'.repeat(1000), '😀 emoji'])('sha1Hex matches node:crypto for %j', (text) => {
    expect(sha1Hex(text)).toBe(createHash('sha1').update(text).digest('hex'));
  });

  it('decodes URL-safe base64 like Buffer does', () => {
    const raw = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 104, 116, 116, 112]).toString('base64url');
    expect(base64ToLatin1(raw)).toBe(Buffer.from(raw, 'base64url').toString('latin1'));
  });
});
