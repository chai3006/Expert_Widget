// Checks every careerUrl in employers.json and every website in watchlist.json: status code and
// redirect chain. Watchlist entries without a website are listed as skipped.
//
//   npm run check-links                          report only (defaults/employers.json, defaults/watchlist.json)
//   npm run check-links -- --write               also set lastVerified (today) for links answering 2xx
//   npm run check-links -- --file <path>         check another employers.json, e.g. your edited copy
//   npm run check-links -- --watchlist <path>    check another watchlist.json
//
// Requests go one at a time with a pause between them and a clear User-Agent.

import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const write = args.includes('--write');
const argPath = (flag, fallback) => (args.indexOf(flag) >= 0 ? resolve(args[args.indexOf(flag) + 1]) : join(root, 'defaults', fallback));
const employersFile = argPath('--file', 'employers.json');
const watchlistFile = argPath('--watchlist', 'watchlist.json');

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

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
const today = new Date().toISOString().slice(0, 10);
const failed = [];
let okCount = 0;
let skipped = 0;

/** Checks `entry[urlKey]` for each entry; sets lastVerified on success when --write is given. */
async function checkAll(title, entries, urlKey) {
  console.log(`# ${title}`);
  for (const entry of entries) {
    const url = entry[urlKey];
    if (!url) {
      console.log(`  SKIP        ${entry.name.padEnd(20)} (no ${urlKey} yet)`);
      skipped++;
      continue;
    }
    const r = await check(url);
    console.log(`  ${r.ok ? 'OK  ' : 'FAIL'} ${String(r.status).padEnd(6)} ${entry.name.padEnd(20)} ${url}`);
    for (const hop of r.chain) console.log(`         ${hop}`);
    if (r.ok) {
      okCount++;
      if (write) entry.lastVerified = today;
    } else {
      failed.push({ name: entry.name, url, status: r.status });
    }
    await sleep(PAUSE_MS);
  }
}

function save(file, data) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  renameSync(tmp, file);
}

const employers = readJson(employersFile);
console.log(`Checking career links in ${employersFile}\n`);
for (const segment of employers.segments) await checkAll(segment.segment, segment.companies, 'careerUrl');

const watchlist = readJson(watchlistFile);
console.log(`\nChecking websites in ${watchlistFile}\n`);
await checkAll('Watchlist', watchlist.companies, 'website');

console.log(`\n${okCount} OK, ${failed.length} failed, ${skipped} skipped.`);
for (const f of failed) console.log(`  failed: ${f.name} (${f.status}) ${f.url}`);

if (write) {
  save(employersFile, employers);
  save(watchlistFile, watchlist);
  console.log(`\nWrote lastVerified=${today} for ${okCount} links to ${employersFile} and ${watchlistFile}`);
}
