// Company directory tooling (Phase 4) with a mocked language model and fixture pages: no test calls
// the real API or the network.

import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateDirectory } from '../packages/core/src/directory.js';
import { run } from '../tools/company-directory/src/cli.js';
import { diffDirectories, formatReview } from '../tools/company-directory/src/directory.js';
import { estimateCost, type LlmClient, type LlmRequest } from '../tools/company-directory/src/llm.js';
import { buildRequest, parseProposals } from '../tools/company-directory/src/prompt.js';
import { belongsToCompany, duplicateProblem, looksParked, verifyCompany, type Page, type PageFetcher } from '../tools/company-directory/src/verify.js';
import { ROOT, registry } from './helpers/config.js';
import { schemaErrors } from './helpers/schemas.js';

const careerPage = (company: string) => `<html><h1>Karriere bei ${company}</h1><a href="/jobs">Offene Stellen</a> Jetzt bewerben</html>`;
const impressum = (company: string) => `<html><h1>Impressum</h1><p>${company} GmbH, Musterstraße 1, 10115 Berlin</p></html>`;

/** A fake web: URL → page, or an error when the URL is not in the map. */
function web(pages: Record<string, Page | string>): PageFetcher & { requested: string[] } {
  const requested: string[] = [];
  return {
    requested,
    getPage: async (url: string) => {
      requested.push(url);
      const p = pages[url];
      if (p === undefined) throw new Error('the server answered HTTP 404');
      return typeof p === 'string' ? { finalUrl: url, body: p } : p;
    },
  };
}

const PAGES = {
  // A real-looking hospital group.
  'https://www.klinikgruppe-beispiel.de': '<html>Klinikgruppe Beispiel</html>',
  'https://karriere.klinikgruppe-beispiel.de': careerPage('Klinikgruppe Beispiel'),
  'https://www.klinikgruppe-beispiel.de/impressum': impressum('Klinikgruppe Beispiel'),
  // Career link that is dead.
  'https://www.pflege-nord.de': '<html>Pflege Nord</html>',
  'https://www.pflege-nord.de/impressum': impressum('Pflege Nord'),
  // Career link that redirects to another company.
  'https://www.reha-sued.de': '<html>Reha Süd</html>',
  'https://www.reha-sued.de/karriere': { finalUrl: 'https://jobs.ganz-andere-firma.de/', body: careerPage('Ganz andere Firma') },
  'https://www.reha-sued.de/impressum': impressum('Reha Süd'),
  // A parked domain.
  'https://www.altenheim-west.de': '<html>This domain is for sale! Buy this domain at sedo.</html>',
  'https://www.altenheim-west.de/jobs': '<html>This domain may be for sale</html>',
  // A career page on a hosted job board naming the brand.
  'https://www.ambulant-ost.de': '<html>Ambulant Ost</html>',
  'https://ambulant-ost.jobs.personio.de': careerPage('Ambulant Ost'),
  'https://www.ambulant-ost.de/impressum': impressum('Ambulant Ost'),
};

const company = (name: string, website: string, careerUrl: string) => ({ name, website, careerUrl });

describe('verification rules', () => {
  it('verifies a company whose site, career page and legal notice all check out', async () => {
    const v = await verifyCompany(company('Klinikgruppe Beispiel', 'https://www.klinikgruppe-beispiel.de', 'https://karriere.klinikgruppe-beispiel.de'), [], web(PAGES), undefined, '2026-10-22');
    expect(v).toMatchObject({ status: 'verified', confidence: 1, sources: ['http-check 2026-10-22', 'impressum /impressum'] });
  });

  it('keeps a dead career link proposed', async () => {
    const v = await verifyCompany(company('Pflege Nord', 'https://www.pflege-nord.de', 'https://www.pflege-nord.de/stellen'), [], web(PAGES));
    expect(v.status).toBe('proposed');
    expect(v.checks.career).toMatch(/does not answer \(the server answered HTTP 404\)/);
  });

  it('keeps a career link that redirects to another company proposed', async () => {
    const v = await verifyCompany(company('Reha Süd', 'https://www.reha-sued.de', 'https://www.reha-sued.de/karriere'), [], web(PAGES));
    expect(v.status).toBe('proposed');
    expect(v.checks.career).toBe("leads to jobs.ganz-andere-firma.de, not the company's site");
  });

  it('keeps a parked domain proposed', async () => {
    const v = await verifyCompany(company('Altenheim West', 'https://www.altenheim-west.de', 'https://www.altenheim-west.de/jobs'), [], web(PAGES));
    expect(v.status).toBe('proposed');
    expect(v.checks.website).toBe('the domain looks parked or for sale');
    expect(looksParked('<p>Diese Domain kaufen</p>')).toBe(true);
  });

  it('refuses duplicates and flags look-alikes', async () => {
    const accepted = [company('Klinikgruppe Beispiel GmbH', 'https://www.klinikgruppe-beispiel.de', 'https://karriere.klinikgruppe-beispiel.de')];
    expect(duplicateProblem(company('Klinikgruppe Beispiel', 'https://x.de', 'https://x.de/jobs'), accepted)).toBe('same name as "Klinikgruppe Beispiel GmbH"');
    expect(duplicateProblem(company('KGB Kliniken', 'https://karriere.klinikgruppe-beispiel.de', 'https://x.de'), accepted)).toBe('same website as "Klinikgruppe Beispiel GmbH"');
    expect(duplicateProblem(company('Klinikgrupe Beispiel', 'https://y.de', 'https://y.de'), accepted)).toBe('look-alike of "Klinikgruppe Beispiel GmbH"');
    const v = await verifyCompany(company('Klinikgruppe Beispiel', 'https://www.klinikgruppe-beispiel.de', 'https://karriere.klinikgruppe-beispiel.de'), accepted, web(PAGES));
    expect(v.status).toBe('proposed');
  });

  it('keeps a hallucinated company proposed: nothing answers and no second source names it', async () => {
    const f = web(PAGES);
    const v = await verifyCompany(company('Erfundene Pflege AG', 'https://www.erfundene-pflege-ag.de', 'https://www.erfundene-pflege-ag.de/karriere'), [], f);
    expect(v).toMatchObject({ status: 'proposed', checks: { website: expect.stringContaining('does not answer'), career: expect.stringContaining('does not answer'), second: 'no second source names the company' } });
    expect(v.confidence).toBeLessThan(0.5);
  });

  it('accepts a hosted job board when it names the company', async () => {
    expect(belongsToCompany('https://ambulant-ost.jobs.personio.de', 'https://www.ambulant-ost.de', 'Ambulant Ost')).toBe(true);
    expect(belongsToCompany('https://anderer-pflegedienst.jobs.personio.de', 'https://www.ambulant-ost.de', 'Ambulant Ost')).toBe(false);
    expect(belongsToCompany('https://www.bmwgroup.jobs/de', 'https://www.bmwgroup.com', 'BMW Group')).toBe(true);
    const v = await verifyCompany(company('Ambulant Ost', 'https://www.ambulant-ost.de', 'https://ambulant-ost.jobs.personio.de'), [], web(PAGES));
    expect(v.status).toBe('verified');
  });
});

// ---- The generator, with a mocked model ------------------------------------------------------

class MockLlm implements LlmClient {
  readonly model = 'claude-opus-5-5';
  calls: LlmRequest[] = [];
  constructor(private readonly answer: unknown) {}
  async complete(request: LlmRequest) {
    this.calls.push(request);
    return { text: JSON.stringify(this.answer), inputTokens: 900, outputTokens: 2500, model: this.model, cached: false };
  }
}

const ANSWER = {
  companies: [
    { name: 'Klinikgruppe Beispiel', website: 'https://www.klinikgruppe-beispiel.de', careerUrl: 'https://karriere.klinikgruppe-beispiel.de', tier: 'top', segment: 'Hospital groups' },
    { name: 'Ambulant Ost', website: 'https://www.ambulant-ost.de', careerUrl: 'https://ambulant-ost.jobs.personio.de', tier: 'sme', segment: 'Home care services' },
    { name: 'Erfundene Pflege AG', website: 'https://www.erfundene-pflege-ag.de', careerUrl: 'https://www.erfundene-pflege-ag.de/karriere', tier: 'tier1', segment: 'Care home operators' },
    { name: 'Klinikgruppe Beispiel GmbH', website: 'https://www.klinikgruppe-beispiel.de', careerUrl: 'https://karriere.klinikgruppe-beispiel.de', tier: 'top', segment: 'Hospital groups' },
    { name: '', website: 'x', careerUrl: 'y', tier: 'top', segment: '' },
  ],
};

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'expert-directory-'));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

async function generate(args: string[], llm: MockLlm) {
  const lines: string[] = [];
  const code = await run(['generate', '--domain', 'healthcare-nursing', ...args], {
    llm,
    fetcher: web(PAGES),
    today: '2026-10-22',
    log: (s) => lines.push(s),
    paths: { root: ROOT, employers: join(tmp, 'employers'), cache: join(tmp, 'cache') },
  });
  return { code, out: lines.join('\n') };
}

describe('directory:generate', () => {
  it('is a dry run by default: shows the request and its cost, calls nothing', async () => {
    const llm = new MockLlm(ANSWER);
    const { code, out } = await generate([], llm);
    expect(code).toBe(0);
    expect(llm.calls).toHaveLength(0);
    expect(out).toContain('Dry run: nothing was sent');
    expect(out).toMatch(/Worst-case cost of the call: \$0\.3\d\d/);
  });

  it('asks only about the domain, never about a person or a CV', () => {
    const r = buildRequest(registry().get('healthcare-nursing')!, 40, 16000);
    expect(r.prompt).toContain('Healthcare & nursing');
    expect(r.prompt).toContain(registry().get('healthcare-nursing')!.description);
    expect(`${r.system} ${r.prompt}`).not.toMatch(/\bCV\b|Lebenslauf|résumé|profile|weights/i);
  });

  it('stops before calling when the worst-case cost is above --max-cost', async () => {
    const llm = new MockLlm(ANSWER);
    const { code, out } = await generate(['--confirm', '--max-cost', '0.05'], llm);
    expect(code).toBe(1);
    expect(llm.calls).toHaveLength(0);
    expect(out).toContain('above --max-cost');
  });

  it('with --confirm proposes, verifies, saves a valid file and caches the answer', async () => {
    const llm = new MockLlm(ANSWER);
    const { code, out } = await generate(['--confirm'], llm);
    expect(code).toBe(0);
    expect(llm.calls).toHaveLength(1);
    expect(out).toContain('note: entry 5 is incomplete and was dropped');
    const saved = JSON.parse(readFileSync(join(tmp, 'employers', 'healthcare-nursing.json'), 'utf8'));
    expect(schemaErrors('EmployerDirectory', saved)).toEqual([]);
    expect(validateDirectory(saved, registry(), 'healthcare-nursing').ok).toBe(true);
    const all = saved.segments.flatMap((s: { companies: Array<{ name: string; status: string }> }) => s.companies);
    expect(all.map((c: { name: string }) => c.name)).toEqual(['Klinikgruppe Beispiel', 'Erfundene Pflege AG', 'Ambulant Ost']);
    expect(Object.fromEntries(all.map((c: { name: string; status: string }) => [c.name, c.status]))).toEqual({ 'Klinikgruppe Beispiel': 'verified', 'Ambulant Ost': 'verified', 'Erfundene Pflege AG': 'proposed' });
    expect(saved.segments[0].companies[0].generatedBy).toBe('claude-opus-5-5 via tools/company-directory 2026-10-22');

    // A second run uses the cached answer: no call, no cost.
    const again = await generate(['--confirm'], llm);
    expect(again.out).toContain('A cached answer exists: no API call, no cost.');
    expect(llm.calls).toHaveLength(1);
    expect(readdirSync(join(tmp, 'cache', 'llm'))).toHaveLength(1);
  });

  it('review lists added companies and the ones that need a look', async () => {
    await generate(['--confirm'], new MockLlm(ANSWER));
    const lines: string[] = [];
    await run(['review', '--domain', 'healthcare-nursing'], { log: (s) => lines.push(s), paths: { root: ROOT, employers: join(tmp, 'employers'), cache: join(tmp, 'cache') } });
    const out = lines.join('\n');
    expect(out).toContain('Added (3)');
    expect(out).toMatch(/Needs a look .*\(1\)/);
    expect(out).toContain('Erfundene Pflege AG · proposed');
  });

  it('explains wrong arguments', async () => {
    const lines: string[] = [];
    expect(await run(['generate'], { log: (s) => lines.push(s) })).toBe(2);
    expect(await run(['generate', '--domain', 'cooking'], { log: (s) => lines.push(s) })).toBe(2);
    expect(lines).toEqual(['directory: --domain <id> is required', 'directory: unknown domain "cooking"']);
  });
});

describe('directory data', () => {
  it.each(readdirSync(join(ROOT, 'data', 'employers')))('%s matches the EmployerDirectory schema', (file) => {
    const doc = JSON.parse(readFileSync(join(ROOT, 'data', 'employers', file), 'utf8'));
    expect(schemaErrors('EmployerDirectory', doc)).toEqual([]);
    expect(validateDirectory(doc, registry(), file.replace(/\.json$/, '')).ok).toBe(true);
  });

  it('parses proposals and estimates cost from the model price table', () => {
    expect(parseProposals('not json')).toEqual({ companies: [], problems: ['the answer is not JSON'] });
    expect(estimateCost('claude-opus-5-5', { system: 'x'.repeat(350), prompt: '', maxTokens: 1000 })).toBeCloseTo((100 * 4 + 1000 * 20) / 1e6, 6);
    expect(() => estimateCost('gpt-x', { system: '', prompt: '', maxTokens: 1 })).toThrow(/no price known/);
  });

  it('diffs two versions', () => {
    const before = { schemaVersion: 1 as const, domain: 'x', segments: [{ tier: 'top' as const, label: { de: 'a', en: 'a' }, companies: [{ name: 'A', website: 'https://a.de', careerUrl: 'https://a.de/jobs', status: 'verified' as const, confidence: 1, lastVerified: '2026-10-01', generatedBy: 'manual', sources: [] }] }] };
    const after = structuredClone(before);
    after.segments[0].companies[0].careerUrl = 'https://a.de/karriere';
    expect(formatReview('x', diffDirectories(before, after))).toContain('A: careerUrl https://a.de/jobs → https://a.de/karriere');
  });
});
