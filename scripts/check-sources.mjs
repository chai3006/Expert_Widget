// Calls every news provider once with a test query and prints a table:
// status (ok / empty / failed), item count and one sample headline.
//
//   npm run check-sources                                   all providers in defaults/config.json
//   npm run check-sources -- --config <path>                another config.json, e.g. your edited copy
//   npm run check-sources -- --domains automotive-emobility,energy-storage
//
// Disabled sources and search providers are checked too, so you can see whether turning them on
// would work. The test query uses only config keyword lists (no CV). Same polite fetcher as the
// app: User-Agent, robots.txt, per-host gaps (5.5 s for GDELT), no cache between runs.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const main = (p) => require(join(root, 'dist', 'main', p));

const { validateConfig, parseJson } = main('config.js');
const { FeedProvider, GdeltProvider, GoogleNewsProvider, HOST_INTERVALS_MS } = main('providers.js');
const { PoliteFetcher } = main('news/fetcher.js');
const { buildProviderQuery } = main('news/adapters/search.js');
const { checkContract } = main('news/provider.js');

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const configPath = resolve(arg('--config') ?? join(root, 'defaults', 'config.json'));
const parsed = parseJson(readFileSync(configPath, 'utf8'), configPath);
const validated = parsed.ok ? validateConfig(parsed.value) : parsed;
if (!validated.ok) {
  console.error(validated.errors.join('\n'));
  process.exit(2);
}
const config = validated.value;
const domains = (arg('--domains') ?? 'automotive-emobility').split(',').map((d) => d.trim());
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

const cacheDir = mkdtempSync(join(tmpdir(), 'expert-check-sources-'));
const fetcher = new PoliteFetcher({
  userAgent: `ExpertWidget/${version} (personal desktop widget; manual refresh only)`,
  cacheDir,
  fetchImpl: (url, init) => fetch(url, init),
  hostIntervalsMs: HOST_INTERVALS_MS,
});

const providers = [
  ...config.sources.map((s) => ({ provider: new FeedProvider(s, fetcher), enabled: s.enabled })),
  { provider: new GdeltProvider(fetcher, config.search.gdelt.maxRecords), enabled: config.search.gdelt.enabled },
  { provider: new GoogleNewsProvider(fetcher), enabled: config.search.googleNews.enabled },
];
const query = buildProviderQuery(config, domains);
console.log(`Test query: domains ${domains.join(', ')}; ${query.signalKeywords.length} signal keywords; last ${query.maxAgeDays} days\n`);

const rows = [];
for (const { provider, enabled } of providers) {
  const started = Date.now();
  let status;
  let count = 0;
  let sample = '';
  try {
    const items = await provider.fetch(query);
    checkContract(items, provider.topic);
    count = items.length;
    status = count > 0 ? 'ok' : 'empty';
    sample = items[0]?.headline ?? '';
  } catch (err) {
    status = 'failed';
    sample = err instanceof Error ? err.message : String(err);
  }
  const row = { provider: provider.name, layer: provider.layer, enabled: enabled ? 'yes' : 'no', status, items: count, seconds: ((Date.now() - started) / 1000).toFixed(1), sample };
  rows.push(row);
  console.log(`${row.status.padEnd(6)} L${row.layer} ${row.provider.padEnd(32)} ${String(row.items).padStart(3)} items  ${row.sample.slice(0, 90)}`);
}

rmSync(cacheDir, { recursive: true, force: true });
console.log('');
console.table(rows.map(({ sample, ...r }) => ({ ...r, 'sample headline / error': sample.slice(0, 70) })));
process.exitCode = rows.some((r) => r.enabled === 'yes' && r.status === 'failed') ? 1 : 0;
