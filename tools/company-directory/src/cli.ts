// Company directory tooling for maintainers (not part of the app).
//
//   npm run directory:generate -- --domain <id> [--max-companies 40] [--max-cost 1.00] [--confirm]
//   npm run directory:verify   -- --domain <id>
//   npm run directory:review   -- --domain <id>
//
// generate is a dry run unless --confirm is given: it prints the request and its worst-case cost and
// calls nothing. With --confirm it calls the Claude API (key from ANTHROPIC_API_KEY, never stored),
// caches the answer, merges the proposals into data/employers/<id>.json and verifies every entry.
// The previous file is kept in tools/company-directory/.cache/ so review can show what changed.

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EmployerDirectory } from '../../../packages/core/src/contracts.js';
import { validateDirectory } from '../../../packages/core/src/directory.js';
import { findAppRoot, loadDomainRegistry } from '../../../packages/node/src/appData.js';
import { PoliteFetcher } from '../../../packages/node/src/fetcher.js';
import { diffDirectories, formatReview, mergeProposals } from './directory.js';
import { CachedLlmClient, ClaudeClient, DEFAULT_MODEL, actualCost, estimateCost, type LlmClient } from './llm.js';
import { buildRequest, parseProposals } from './prompt.js';
import { applyVerification, verifyCompany, type PageFetcher } from './verify.js';

export interface Paths {
  root: string;
  employers: string;
  cache: string;
}

export function paths(root = findAppRoot()): Paths {
  return { root, employers: join(root, 'data', 'employers'), cache: join(root, 'tools', 'company-directory', '.cache') };
}

export interface Options {
  command: 'generate' | 'verify' | 'review';
  domain: string;
  maxCompanies: number;
  maxCost: number;
  maxTokens: number;
  model: string;
  confirm: boolean;
}

export function parseArgs(argv: readonly string[]): Options | { error: string } {
  const [command, ...rest] = argv;
  if (command !== 'generate' && command !== 'verify' && command !== 'review') return { error: 'command must be generate, verify or review' };
  const o: Options = { command, domain: '', maxCompanies: 40, maxCost: 1, maxTokens: 16000, model: DEFAULT_MODEL, confirm: false };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    const num = () => Number(rest[++i]);
    if (a === '--domain') o.domain = rest[++i] ?? '';
    else if (a === '--max-companies') o.maxCompanies = num();
    else if (a === '--max-cost') o.maxCost = num();
    else if (a === '--max-tokens') o.maxTokens = num();
    else if (a === '--model') o.model = rest[++i] ?? '';
    else if (a === '--confirm') o.confirm = true;
    else if (a === '--dry-run') o.confirm = false;
    else return { error: `unknown option ${a}` };
  }
  if (!o.domain) return { error: '--domain <id> is required' };
  if (!(o.maxCompanies >= 1 && o.maxCompanies <= 100)) return { error: '--max-companies must be 1 to 100' };
  if (!(o.maxCost > 0)) return { error: '--max-cost must be a positive number of US dollars' };
  return o;
}

function readDirectory(p: Paths, domain: string): EmployerDirectory {
  const file = join(p.employers, `${domain}.json`);
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as EmployerDirectory) : { schemaVersion: 1, domain, segments: [] };
}

function writeDirectory(p: Paths, d: EmployerDirectory): void {
  mkdirSync(p.employers, { recursive: true });
  writeFileSync(join(p.employers, `${d.domain}.json`), `${JSON.stringify(d, null, 2)}\n`);
}

/** Keeps the current file as the "before" of the next review. */
function snapshot(p: Paths, domain: string): void {
  const file = join(p.employers, `${domain}.json`);
  mkdirSync(p.cache, { recursive: true });
  if (existsSync(file)) copyFileSync(file, join(p.cache, `${domain}.previous.json`));
}

export async function verifyAll(d: EmployerDirectory, fetcher: PageFetcher, today: string, log: (s: string) => void): Promise<EmployerDirectory> {
  const next = structuredClone(d);
  const accepted: Array<{ name: string; website: string; careerUrl: string }> = [];
  for (const segment of next.segments) {
    for (let i = 0; i < segment.companies.length; i++) {
      const c = segment.companies[i];
      const v = await verifyCompany(c, accepted, fetcher, undefined, today);
      segment.companies[i] = applyVerification(c, v, today);
      if (v.checks.duplicate === 'ok') accepted.push(c);
      log(`${v.status === 'verified' ? 'verified' : 'proposed'}  ${v.confidence.toFixed(2)}  ${c.name}${v.status === 'verified' ? '' : `  (${Object.entries(v.checks).filter(([, r]) => r !== 'ok').map(([k, r]) => `${k}: ${r}`).join('; ')})`}`);
    }
  }
  return next;
}

export interface Deps {
  llm?: LlmClient;
  fetcher?: PageFetcher;
  today?: string;
  log?: (s: string) => void;
  paths?: Paths;
}

export async function run(argv: readonly string[], deps: Deps = {}): Promise<number> {
  const log = deps.log ?? ((s: string) => process.stdout.write(`${s}\n`));
  const o = parseArgs(argv);
  if ('error' in o) {
    log(`directory: ${o.error}`);
    return 2;
  }
  const p = deps.paths ?? paths();
  const registry = loadDomainRegistry(join(p.root, 'data', 'domains'));
  if (!registry.ok) {
    log(registry.errors.join('\n'));
    return 2;
  }
  const domain = registry.value.get(o.domain);
  if (!domain || domain.fallback) {
    log(`directory: unknown domain "${o.domain}"`);
    return 2;
  }
  const today = deps.today ?? new Date().toISOString().slice(0, 10);
  const fetcher =
    deps.fetcher ??
    new PoliteFetcher({ userAgent: 'ExpertWidget-directory/0.1.0 (company list check; https://github.com/chai3006/Expert_Widget)', cacheDir: join(p.cache, 'http'), fetchImpl: (url, init) => fetch(url, init), hostIntervalsMs: { 'api.gdeltproject.org': 5500 } });

  if (o.command === 'review') {
    const prevFile = join(p.cache, `${o.domain}.previous.json`);
    const before = existsSync(prevFile) ? (JSON.parse(readFileSync(prevFile, 'utf8')) as EmployerDirectory) : null;
    log(formatReview(o.domain, diffDirectories(before, readDirectory(p, o.domain))));
    return 0;
  }

  if (o.command === 'verify') {
    snapshot(p, o.domain);
    const next = await verifyAll(readDirectory(p, o.domain), fetcher, today, log);
    return save(p, next, registry.value, log);
  }

  // generate
  const request = buildRequest(domain, o.maxCompanies, o.maxTokens);
  const estimate = estimateCost(o.model, request);
  const cache = new CachedLlmClient(deps.llm ?? lazyClaude(o.model), join(p.cache, 'llm'));
  const cached = cache.cachedAnswer(request);
  log(`Domain: ${domain.id} (${domain.label.en}); model ${o.model}; up to ${o.maxCompanies} companies.`);
  log(cached ? 'A cached answer exists: no API call, no cost.' : `Worst-case cost of the call: $${estimate.toFixed(3)} (cap $${o.maxCost.toFixed(2)}).`);
  if (!o.confirm) {
    log('\nDry run: nothing was sent. The request would be:\n');
    log(`SYSTEM: ${request.system}\n\nUSER: ${request.prompt}`);
    log('\nRun again with --confirm to call the API (needs ANTHROPIC_API_KEY).');
    return 0;
  }
  if (!cached && estimate > o.maxCost) {
    log(`Stopped: the worst-case cost $${estimate.toFixed(3)} is above --max-cost $${o.maxCost.toFixed(2)}.`);
    return 1;
  }
  const answer = await cache.complete(request);
  log(`Answer from ${answer.model}${answer.cached ? ' (cached)' : ''}: ${answer.inputTokens} input and ${answer.outputTokens} output tokens, cost $${actualCost(o.model, answer).toFixed(3)}.`);
  const { companies, problems } = parseProposals(answer.text);
  for (const pr of problems) log(`note: ${pr}`);
  log(`${companies.length} companies proposed. Verifying…`);
  snapshot(p, o.domain);
  const merged = mergeProposals(readDirectory(p, o.domain), companies, `${answer.model} via tools/company-directory ${today}`);
  const next = await verifyAll(merged, fetcher, today, log);
  const code = save(p, next, registry.value, log);
  log('\nNext: npm run directory:review -- --domain ' + o.domain);
  return code;
}

function lazyClaude(model: string): LlmClient {
  let client: ClaudeClient | null = null;
  return {
    model,
    complete: (r) => (client ??= new ClaudeClient(model)).complete(r),
  };
}

function save(p: Paths, d: EmployerDirectory, registry: Parameters<typeof validateDirectory>[1], log: (s: string) => void): number {
  const valid = validateDirectory(d, registry, d.domain);
  if (!valid.ok) {
    log(`Not saved, the result is invalid:\n${valid.errors.join('\n')}`);
    return 1;
  }
  writeDirectory(p, d);
  const all = d.segments.flatMap((s) => s.companies);
  log(`Saved data/employers/${d.domain}.json: ${all.filter((c) => c.status === 'verified').length} verified, ${all.filter((c) => c.status === 'proposed').length} proposed (hidden in the app).`);
  return 0;
}

if (require.main === module) {
  run(process.argv.slice(2)).then(
    (code) => (process.exitCode = code),
    (err) => {
      process.stderr.write(`directory: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 2;
    },
  );
}
