#!/usr/bin/env node
// expert-cli: the Expert pipeline without Electron.
//
//   expert-cli --cv <file> [--config <dir>] [--state <dir>] [--no-network] [--json]
//
// Reads one CV on this computer, computes the domain mix, lists the employers for it and (unless
// --no-network) loads the news, then prints the data payload. The CV text stays in this process:
// it is never printed, stored or sent. --config is a folder with config.json, employers.json and
// watchlist.json (missing files fall back to the bundled defaults). --state keeps the state and
// HTTP cache in a folder between runs; without it everything is kept in memory.

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { ExpertEngine } from '../../core/src/engine.js';
import { startService } from './serve.js';
import { buildProviders, HOST_INTERVALS_MS } from '../../core/src/news/providers.js';
import { MemoryHttpCache } from '../../core/src/ports.js';
import { ProfilingCvProvider } from '../../core/src/cv/cvProvider.js';
import { memoryStores, type AppStores } from '../../core/src/state/appState.js';
import { SCHEMA_VERSION } from '../../core/src/contracts.js';
import { FileCvSource } from '../../node/src/cv/folderCvSource.js';
import { PoliteFetcher } from '../../node/src/fetcher.js';
import { FileStores } from '../../node/src/state/fileStores.js';
import { findAppRoot } from '../../node/src/appData.js';
import { loadInputs as loadInputFiles, type LoadedFiles, type UserFiles } from '../../node/src/userFiles.js';

export const USAGE = `Usage: expert-cli --cv <file> [--config <dir>] [--state <dir>] [--no-network] [--json]
       expert-cli serve --cv <file> [--port 4317] [--allow-origin <origin>]... [--config <dir>] [--state <dir>] [--no-network]

  --cv <file>      the CV (.pdf, .docx or .txt, German or English); read on this computer only
  --config <dir>   folder with config.json, employers.json, watchlist.json (default: bundled defaults)
  --state <dir>    keep state and HTTP cache in this folder between runs (default: memory only)
  --no-network     do not fetch news; only the domain mix and the employers
  --json           print the data payload as JSON (default: a short text summary)

  serve            run the local Expert service on 127.0.0.1 for the Expert page (see docs/EXPERT_PAGE_INTEGRATION.md)
  --port <n>       port of the service (default 4317; 0 picks a free one)
  --allow-origin   a web origin allowed to call the service, e.g. http://localhost:3000 (repeatable)
`;

export interface CliOptions {
  serve: boolean;
  port: number;
  allowOrigins: string[];
  cv: string;
  config: string | null;
  state: string | null;
  network: boolean;
  json: boolean;
}

export function parseArgs(argv: readonly string[]): CliOptions | { error: string } {
  const opts: CliOptions = { serve: false, port: 4317, allowOrigins: [], cv: '', config: null, state: null, network: true, json: false };
  for (let i = 0; i < argv.length; i++) {
    if (i === 0 && argv[0] === 'serve') {
      opts.serve = true;
      continue;
    }
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
      return v;
    };
    try {
      if (a === '--cv') opts.cv = value();
      else if (a === '--config') opts.config = value();
      else if (a === '--state') opts.state = value();
      else if (a === '--no-network') opts.network = false;
      else if (a === '--json') opts.json = true;
      else if (a === '--port' && opts.serve) {
        const n = Number(value());
        if (!Number.isInteger(n) || n < 0 || n > 65535) return { error: '--port must be a whole number from 0 to 65535' };
        opts.port = n;
      } else if (a === '--allow-origin' && opts.serve) {
        const o = value();
        let parsed: URL | null = null;
        try {
          parsed = new URL(o);
        } catch {
          parsed = null;
        }
        if (!parsed || parsed.origin !== o) return { error: `--allow-origin must be an origin like http://localhost:3000 (got "${o}")` };
        opts.allowOrigins.push(o);
      } else return { error: `unknown option ${a}` };
    } catch (err) {
      return { error: (err as Error).message };
    }
  }
  if (!opts.cv) return { error: '--cv <file> is required' };
  return opts;
}

/** The repository (or installed app) folder with defaults/ and data/. */
export const APP_ROOT = findAppRoot();
export const DEFAULTS_DIR = join(APP_ROOT, 'defaults');

/** The input files: those in --config when present there, else the bundled defaults. */
export function cliFiles(configDir: string | null, defaultsDir = DEFAULTS_DIR): UserFiles {
  const pick = (name: string) => (configDir && existsSync(join(configDir, name)) ? join(configDir, name) : join(defaultsDir, name));
  return { home: configDir ?? defaultsDir, configPath: pick('config.json'), employersPath: pick('employers.json'), watchlistPath: pick('watchlist.json') };
}

export interface CliRun {
  engine: ExpertEngine;
  stores: AppStores;
}

export function createCliEngine(opts: CliOptions, fetchImpl: typeof fetch = fetch, now: () => number = Date.now): CliRun {
  const files = cliFiles(opts.config ? resolve(opts.config) : null);
  const cvPath = resolve(opts.cv);
  const stores: AppStores = opts.state ? new FileStores(resolve(opts.state)) : memoryStores();
  const cache = opts.state ? undefined : new MemoryHttpCache();
  const loadInputs = (): LoadedFiles => {
    const loaded = loadInputFiles(files, join(APP_ROOT, 'data'), process.env, homedir());
    // The CV is the --cv file, whatever cvFolder in config.json says.
    return { ...loaded, cvFolder: dirname(cvPath) };
  };
  const engine = new ExpertEngine({
    loadInputs,
    stores,
    cv: new ProfilingCvProvider(() => new FileCvSource(cvPath), undefined, now),
    providers: (config) =>
      opts.network
        ? buildProviders(
            config,
            new PoliteFetcher({
              userAgent: `ExpertWidget-cli/0.1.0 (manual run)`,
              ...(cache ? { cache } : { cacheDir: (stores as FileStores).httpCacheDir }),
              fetchImpl: (url, init) => fetchImpl(url, init),
              hostIntervalsMs: HOST_INTERVALS_MS,
            }),
          )
        : [],
    isOnline: () => opts.network,
    translator: () => null,
    now,
  });
  return { engine, stores };
}

/** The data payload printed with --json. */
export function payload(engine: ExpertEngine, now: number) {
  const view = engine.view();
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date(now).toISOString(),
    profile: engine.domainProfile(),
    cvProblem: view.ui.cvStatus?.text ?? null,
    configError: view.ui.configError,
    employers: view.data.employers.map((d) => ({
      domain: d.domain,
      label: d.label,
      weight: d.weight,
      segments: d.segments.map((s) => ({ segment: s.segment, companies: s.companies.map((c) => ({ name: c.name, careerUrl: c.careerUrl })) })),
    })),
    news: engine.newsItems(),
    companySignals: engine.companySignals(),
    sourceHealth: engine.sourceHealth(),
    messages: view.ui.messages,
  };
}

export function summary(data: ReturnType<typeof payload>): string {
  const lines: string[] = [];
  if (data.configError) return `Configuration problem:\n${data.configError}\n`;
  if (data.cvProblem) lines.push(`CV: ${data.cvProblem}`);
  if (data.profile) {
    lines.push(`Domain mix (${data.profile.source}):`);
    for (const w of data.profile.weights) lines.push(`  ${String(w.weight).padStart(3)}%  ${w.label} (${w.domain})`);
    for (const e of data.profile.evidence) lines.push(`        ${e.domain}: ${e.label} [${e.kind}${e.period ? `, ${e.period}` : ''}${e.current ? ', current' : ''}]`);
  }
  for (const d of data.employers) {
    const n = d.segments.reduce((a, s) => a + s.companies.length, 0);
    lines.push(`Employers for ${d.label}: ${n} ${n === 1 ? 'company' : 'companies'}`);
  }
  lines.push(`News: ${data.news.length} items; sources ${data.sourceHealth.working} of ${data.sourceHealth.total} working`);
  for (const m of data.messages) lines.push(`${m.level}: ${m.text}`);
  return `${lines.join('\n')}\n`;
}

export async function main(argv: readonly string[], out: (s: string) => void = (s) => process.stdout.write(s)): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    out(USAGE);
    return 0;
  }
  const opts = parseArgs(argv);
  if ('error' in opts) {
    out(`expert-cli: ${opts.error}\n\n${USAGE}`);
    return 2;
  }
  const { engine } = createCliEngine(opts);
  if (opts.serve) return serve(engine, opts, out);
  await engine.refresh();
  const data = payload(engine, Date.now());
  out(opts.json ? `${JSON.stringify(data, null, 2)}\n` : summary(data));
  if (data.configError) return 2;
  return data.profile ? 0 : 1;
}

/** Runs until the process is stopped (Ctrl+C). */
async function serve(engine: ExpertEngine, opts: CliOptions, out: (s: string) => void): Promise<number> {
  const service = await startService({
    engine,
    port: opts.port,
    allowOrigins: opts.allowOrigins,
    uiDir: join(APP_ROOT, 'dist', 'ui'),
    exampleDir: join(APP_ROOT, 'examples', 'expert-page'),
  });
  out(`Expert service on ${service.url} (this computer only).\n`);
  out(`Token (send as "Authorization: Bearer <token>"; keep it private):\n  ${service.token}\n`);
  out(`Example page: ${service.url}/example/#token=${service.token}\n`);
  if (opts.allowOrigins.length > 0) out(`Allowed origins: ${opts.allowOrigins.join(', ')}\n`);
  out('Reading the CV and loading news now; press Ctrl+C to stop.\n');
  void engine.refresh();
  await new Promise<void>((resolve) => process.once('SIGINT', () => resolve()));
  await service.close();
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      process.stderr.write(`expert-cli: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 2;
    },
  );
}
