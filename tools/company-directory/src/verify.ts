// Automatic verification of proposed companies. A company becomes "verified" only when every
// required check passes; otherwise it stays "proposed" and the app does not show it. Unchecked
// links are never presented as working.
//
// Checks, in order:
//   url        both URLs are valid https/http addresses
//   website    the homepage answers (redirects followed) and is not a parked domain
//   career     the career URL answers and its final address belongs to the company (same site,
//              same brand on another top-level domain, or a known job-board host naming the brand)
//   jobs       the career page or its links contain job words in German or English
//   duplicate  no other entry has the same name, a look-alike name or the same website
//   second     a second source confirms the company: the legal notice (Impressum) on its website
//              names it, or the GDELT news index has an article naming it
// Fetching goes through the project's polite fetcher: robots.txt, per-host spacing, caching.

import type { DirectoryCompany } from '../../../packages/core/src/contracts.js';
import { foldText } from '../../../packages/core/src/text/keywords.js';

export interface Page {
  finalUrl: string;
  body: string;
}

/** Fetches a page; rejects when it cannot be loaded (HTTP error, network, robots.txt). */
export interface PageFetcher {
  getPage(url: string): Promise<Page>;
}

export type CheckName = 'url' | 'website' | 'career' | 'jobs' | 'duplicate' | 'second';
export const REQUIRED_CHECKS: readonly CheckName[] = ['url', 'website', 'career', 'jobs', 'duplicate', 'second'];

export interface Verification {
  status: 'proposed' | 'verified';
  confidence: number;
  /** Check name → "ok" or the reason it failed. */
  checks: Record<CheckName, string>;
  sources: string[];
}

export interface CompanyToCheck {
  name: string;
  website: string;
  careerUrl: string;
}

// ---- Pure helpers -----------------------------------------------------------------------------

const TWO_LEVEL_SUFFIXES = new Set(['co.uk', 'com.au', 'co.jp', 'com.br', 'co.at', 'or.at', 'com.cn', 'com.tr']);

/** "jobs.example.co.uk" → "example.co.uk"; "www.bosch.de" → "bosch.de". */
export function registrableDomain(host: string): string {
  const parts = host.toLowerCase().replace(/\.$/, '').split('.');
  const lastTwo = parts.slice(-2).join('.');
  return TWO_LEVEL_SUFFIXES.has(lastTwo) ? parts.slice(-3).join('.') : lastTwo;
}

/** The brand part of a host: "bmwgroup.jobs" and "www.bmwgroup.com" are both "bmwgroup". */
export function brandOf(host: string): string {
  return registrableDomain(host).split('.')[0];
}

/** Hosted job boards that many companies use for their career pages. */
const JOB_BOARD_DOMAINS = new Set([
  'personio.de', 'personio.com', 'softgarden.io', 'softgarden.de', 'successfactors.eu', 'successfactors.com', 'myworkdayjobs.com', 'workday.com',
  'greenhouse.io', 'lever.co', 'smartrecruiters.com', 'ashbyhq.com', 'join.com', 'recruitee.com', 'jobs.personio.de', 'onlyfy.jobs', 'dvinci.de',
  'rexx-systems.com', 'umantis.com', 'csod.com', 'taleo.net', 'icims.com', 'jobvite.com', 'teamtailor.com', 'bite.de',
]);

/** Whether the career page's final address belongs to the company with this website. */
export function belongsToCompany(finalUrl: string, website: string, name: string): boolean {
  const finalHost = new URL(finalUrl).hostname;
  const siteHost = new URL(website).hostname;
  if (registrableDomain(finalHost) === registrableDomain(siteHost)) return true;
  if (brandOf(finalHost) === brandOf(siteHost) && brandOf(siteHost).length >= 3) return true;
  // "webasto-group.com" → "webasto.com": one brand is the other plus a dash and a suffix.
  const [short, long] = [brandOf(finalHost), brandOf(siteHost)].sort((x, y) => x.length - y.length);
  if (short.length >= 4 && long.startsWith(`${short}-`)) return true;
  if (JOB_BOARD_DOMAINS.has(registrableDomain(finalHost))) {
    const brand = brandOf(siteHost);
    const nameKey = normaliseName(name).replace(/\s+/g, '');
    const text = foldText(finalUrl).replace(/[^a-z0-9]/g, '');
    return text.includes(brand) || (nameKey.length >= 3 && text.includes(nameKey));
  }
  return false;
}

const PARKED = /domain (?:is|ist|may be) (?:for sale|zu verkaufen)|this domain (?:may be|is) for sale|buy this domain|diese domain (?:kaufen|steht zum verkauf|ist zu verkaufen)|domain kaufen|sedoparking|parkingcrew|bodis\.com|dan\.com|afternic|hugedomains|domain parking/i;

export function looksParked(body: string): boolean {
  return PARKED.test(body);
}

const JOB_WORDS = /karriere|stellenangebot|stellenanzeige|offene stellen|jobs\b|jobangebot|bewerb|ausbildung|arbeiten bei|careers?\b|vacanc|open positions|job openings|join us|work with us|apply now/i;

export function hasJobWords(body: string): boolean {
  return JOB_WORDS.test(body.replace(/<script[\s\S]*?<\/script>/gi, ' '));
}

const LEGAL_FORMS = /\b(gmbh|ag|se|kg|kgaa|ohg|ug|e\s?v|co|mbh|group|gruppe|holding|deutschland|germany|international|inc|ltd|llc|plc|sa|nv|bv)\b/g;

/** Name for comparison: folded, without legal forms and punctuation. "Bosch GmbH" → "bosch". */
export function normaliseName(name: string): string {
  return foldText(name)
    .replace(/[&+.,()/'"-]/g, ' ')
    .replace(LEGAL_FORMS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

/**
 * Duplicates and look-alikes among `others` (the entries already accepted for the domain): the
 * same normalised name or website is a duplicate; names one or two letters apart are look-alikes
 * ("Contintal" next to "Continental"), which a person must check.
 */
export function duplicateProblem(company: CompanyToCheck, others: readonly CompanyToCheck[]): string | null {
  const name = normaliseName(company.name);
  const site = safeHost(company.website);
  for (const o of others) {
    if (o === company) continue;
    const other = normaliseName(o.name);
    if (other === name) return `same name as "${o.name}"`;
    if (site && site === safeHost(o.website)) return `same website as "${o.name}"`;
    if (name.length >= 5 && other.length >= 5 && editDistance(name, other) <= 2) return `look-alike of "${o.name}"`;
  }
  return null;
}

function safeHost(url: string): string | null {
  try {
    return registrableDomain(new URL(url).hostname);
  } catch {
    return null;
  }
}

function isWebUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.includes('.');
  } catch {
    return false;
  }
}

/** The legal-notice pages German company sites are required to have. */
export function impressumUrls(website: string): string[] {
  const origin = new URL(website).origin;
  return ['/impressum', '/de/impressum', '/imprint', '/en/imprint', '/legal-notice', '/de/impressum.html'].map((p) => origin + p);
}

/** Whether a page names the company: its normalised name, or at least its first long word. */
export function namesCompany(body: string, name: string): boolean {
  const text = normaliseName(body.replace(/<[^>]+>/g, ' '));
  const key = normaliseName(name);
  if (key.length >= 3 && text.includes(key)) return true;
  const first = key.split(' ').find((w) => w.length >= 4);
  return first !== undefined && new RegExp(`(?<![a-z0-9])${first}(?![a-z0-9])`).test(text);
}

// ---- The pipeline --------------------------------------------------------------------------

export type SecondSource = (company: CompanyToCheck, fetcher: PageFetcher) => Promise<string | null>;

/** Second source 1: the Impressum on the company's own site names the company. */
export const impressumSource: SecondSource = async (company, fetcher) => {
  for (const url of impressumUrls(company.website)) {
    try {
      const page = await fetcher.getPage(url);
      if (namesCompany(page.body, company.name)) return `impressum ${new URL(page.finalUrl).pathname}`;
    } catch {
      /* try the next address */
    }
  }
  return null;
};

/** Second source 2: the GDELT news index (last 3 months) has an article naming the company. */
export const gdeltSource: SecondSource = async (company, fetcher) => {
  const params = new URLSearchParams({ query: `"${company.name}"`, mode: 'artlist', format: 'json', maxrecords: '5', timespan: '3months' });
  try {
    const page = await fetcher.getPage(`https://api.gdeltproject.org/api/v2/doc/doc?${params.toString()}`);
    const articles = (JSON.parse(page.body) as { articles?: unknown[] }).articles;
    return Array.isArray(articles) && articles.length > 0 ? 'gdelt-mention' : null;
  } catch {
    return null;
  }
};

export const DEFAULT_SECOND_SOURCES: readonly SecondSource[] = [impressumSource, gdeltSource];

const WEIGHT: Record<CheckName, number> = { url: 0.1, website: 0.2, career: 0.2, jobs: 0.15, duplicate: 0.1, second: 0.25 };

export async function verifyCompany(
  company: CompanyToCheck,
  others: readonly CompanyToCheck[],
  fetcher: PageFetcher,
  secondSources: readonly SecondSource[] = DEFAULT_SECOND_SOURCES,
  today = new Date().toISOString().slice(0, 10),
): Promise<Verification> {
  const checks = {} as Record<CheckName, string>;
  const sources: string[] = [];
  const fail = (name: CheckName, why: string) => (checks[name] = why);

  if (!isWebUrl(company.website) || !isWebUrl(company.careerUrl)) {
    fail('url', 'not a valid web address');
  } else {
    checks.url = 'ok';
    try {
      const home = await fetcher.getPage(company.website);
      if (looksParked(home.body)) fail('website', 'the domain looks parked or for sale');
      else checks.website = 'ok';
    } catch (err) {
      fail('website', `does not answer (${errorText(err)})`);
    }
    try {
      const career = await fetcher.getPage(company.careerUrl);
      if (!belongsToCompany(career.finalUrl, company.website, company.name)) fail('career', `leads to ${new URL(career.finalUrl).hostname}, not the company's site`);
      else if (looksParked(career.body)) fail('career', 'the page looks parked or for sale');
      else {
        checks.career = 'ok';
        sources.push(`http-check ${today}`);
      }
      checks.jobs = hasJobWords(career.body) ? 'ok' : 'no job words on the page';
    } catch (err) {
      fail('career', `does not answer (${errorText(err)})`);
      fail('jobs', 'not checked, the page did not load');
    }
  }
  const dup = duplicateProblem(company, others);
  checks.duplicate = dup ?? 'ok';

  let second: string | null = null;
  if (checks.website === 'ok') {
    for (const source of secondSources) {
      second = await source(company, fetcher);
      if (second) break;
    }
  }
  checks.second = second ? 'ok' : 'no second source names the company';
  if (second) sources.push(second);

  const passed = REQUIRED_CHECKS.filter((c) => checks[c] === 'ok');
  let confidence = passed.reduce((a, c) => a + WEIGHT[c], 0);
  if (dup?.startsWith('look-alike')) confidence -= 0.3;
  confidence = Math.max(0, Math.min(1, Math.round(confidence * 100) / 100));
  return { status: passed.length === REQUIRED_CHECKS.length ? 'verified' : 'proposed', confidence, checks, sources };
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Applies a verification result to a directory entry. */
export function applyVerification(company: DirectoryCompany, v: Verification, today: string): DirectoryCompany {
  return {
    ...company,
    status: v.status,
    confidence: v.confidence,
    lastVerified: v.status === 'verified' ? today : company.lastVerified && company.status === 'verified' ? company.lastVerified : '',
    sources: v.status === 'verified' ? v.sources : company.sources,
    checks: v.checks,
  };
}
