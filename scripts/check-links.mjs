// Checks every careerUrl in employers.json: status code and redirect chain.
//
//   npm run check-links                     report only (defaults/employers.json)
//   npm run check-links -- --write          also set lastVerified (today) for links answering 2xx
//   npm run check-links -- --file <path>    check another employers.json, e.g. your edited copy
//
// Requests go one at a time with a pause between them and a clear User-Agent.

import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const write = args.includes('--write');
const fileArg = args.indexOf('--file');
const file = fileArg >= 0 ? resolve(args[fileArg + 1]) : join(root, 'defaults', 'employers.json');

const USER_AGENT = 'ExpertWidget-LinkCheck/0.1 (personal desktop widget; checks career page links)';
const PAUSE_MS = 800;
const MAX_REDIRECTS = 10;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function check(url) {
  const chain = [];
  let current = url;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    let res;
    try {
      res = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,*/*;q=0.8', 'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8' },
        signal: AbortSignal.timeout(20000),
      });
    } catch (err) {
      const reason = err?.cause?.code ?? err?.name ?? 'error';
      return { ok: false, status: reason, chain, finalUrl: current };
    }
    await res.body?.cancel();
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      const next = new URL(res.headers.get('location'), current).toString();
      chain.push(`${res.status} -> ${next}`);
      current = next;
      continue;
    }
    return { ok: res.status >= 200 && res.status < 300, status: res.status, chain, finalUrl: current };
  }
  return { ok: false, status: 'too many redirects', chain, finalUrl: current };
}

const data = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const today = new Date().toISOString().slice(0, 10);
const failed = [];
let okCount = 0;

console.log(`Checking career links in ${file}\n`);
for (const segment of data.segments) {
  console.log(`# ${segment.segment}`);
  for (const company of segment.companies) {
    const r = await check(company.careerUrl);
    const mark = r.ok ? 'OK  ' : 'FAIL';
    console.log(`  ${mark} ${String(r.status).padEnd(6)} ${company.name.padEnd(20)} ${company.careerUrl}`);
    for (const hop of r.chain) console.log(`         ${hop}`);
    if (r.ok) {
      okCount++;
      if (write) company.lastVerified = today;
    } else {
      failed.push({ name: company.name, url: company.careerUrl, status: r.status });
    }
    await sleep(PAUSE_MS);
  }
}

console.log(`\n${okCount} OK, ${failed.length} failed.`);
for (const f of failed) console.log(`  failed: ${f.name} (${f.status}) ${f.url}`);

if (write) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  renameSync(tmp, file);
  console.log(`\nWrote lastVerified=${today} for ${okCount} links to ${file}`);
}
