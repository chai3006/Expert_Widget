// The CV profiler on made-up CVs from many fields (test/fixtures/cv/fields), German and English.

import { describe, expect, it } from 'vitest';
import { DEFAULT_CV_ANALYSIS } from '../packages/core/src/config.js';
import { dateRangeOf, headingOf, parseCv, periodLabel } from '../packages/core/src/cv/cvStructure.js';
import { StructuredCvProfiler, yearOf } from '../packages/core/src/cv/structuredProfiler.js';
import { TermMatcher, umlautVariant } from '../packages/core/src/text/terms.js';
import { foldText } from '../packages/core/src/text/keywords.js';
import { fixture, registry } from './helpers/config.js';

const NOW = new Date(2026, 9, 15).getTime();
const profiler = new StructuredCvProfiler(registry(), DEFAULT_CV_ANALYSIS, () => NOW);
const analyse = (text: string) => profiler.analyse(text);
const cv = (name: string) => fixture('cv', 'fields', name);
const domains = (text: string) => analyse(text).weights.map((w) => w.domain);

// file, expected top domain, domains that must follow in this order (if any), domains that must not appear
const CASES: Array<[string, string, string[], string[]]> = [
  ['nurse-de.txt', 'healthcare-nursing', [], ['medtech', 'software-ai']],
  ['accountant-de.txt', 'accounting-tax', [], ['finance-banking-insurance']],
  ['teacher-de.txt', 'education-research', [], []],
  ['lawyer-de.txt', 'law-compliance', [], []],
  ['developer-en.txt', 'software-ai', [], []],
  ['mechanic-de.txt', 'skilled-trades', ['automotive-emobility'], []],
  ['sales-en.txt', 'sales-retail-ecommerce', [], []],
  ['marketing-de.txt', 'marketing-media', [], []],
  ['logistics-de.txt', 'logistics-supply-chain', [], ['rail-transport']],
  ['hr-en.txt', 'hr-recruiting', [], []],
  ['chef-de.txt', 'hospitality-tourism', [], []],
  ['researcher-en.txt', 'education-research', [], []],
  ['bankclerk-de.txt', 'finance-banking-insurance', [], []],
  ['electrician-de.txt', 'skilled-trades', [], []],
  ['career-changer-de.txt', 'software-ai', ['finance-banking-insurance'], []],
  ['social-worker-de.txt', 'social-work', [], []],
];

describe('CV profiler on CVs from many fields', () => {
  it('has at least 14 fixture CVs in German and English', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(14);
    expect(CASES.some(([f]) => f.endsWith('-de.txt'))).toBe(true);
    expect(CASES.some(([f]) => f.endsWith('-en.txt'))).toBe(true);
  });

  it.each(CASES)('%s → %s', (file, top, next, never) => {
    const result = analyse(cv(file));
    const order = result.weights.map((w) => w.domain);
    expect(result.source).toBe('auto');
    expect(order[0]).toBe(top);
    expect(order.slice(1, 1 + next.length)).toEqual(next);
    for (const d of never) expect(order).not.toContain(d);
    // Whole numbers summing to 100, at most 4, none under 5 %.
    expect(result.weights.reduce((a, w) => a + w.weight, 0)).toBe(100);
    expect(result.weights.length).toBeLessThanOrEqual(4);
    expect(result.weights.every((w) => Number.isInteger(w.weight) && w.weight >= 5)).toBe(true);
    // Every domain in the mix has evidence, and evidence is made of registry terms only.
    for (const w of result.weights) expect(result.evidence.some((e) => e.domain === w.domain), w.domain).toBe(true);
    for (const e of result.evidence) {
      const d = registry().get(e.domain)!;
      const terms = [...d.keywords, ...d.titles, ...d.education].map((t) => t.term);
      expect(terms, `${e.domain}: ${e.label}`).toContain(e.label);
    }
  });

  it('explains the domain with the current role and its dates', () => {
    const nurse = analyse(cv('nurse-de.txt'));
    expect(nurse.evidence[0]).toEqual({ domain: 'healthcare-nursing', label: 'Pflegefachkraft', kind: 'title', period: '2020 to now', current: true });
    const changer = analyse(cv('career-changer-de.txt'));
    const finance = changer.evidence.filter((e) => e.domain === 'finance-banking-insurance');
    expect(finance.some((e) => e.period === '2010 to 2019' && !e.current)).toBe(true);
  });
});

describe('current and previous experience', () => {
  const nurseThenDeveloper = (nurse: string, developer: string) =>
    [
      'Berufserfahrung',
      `${nurse}   Pflegefachkraft, Klinikum Musterstadt`,
      '  - Grundpflege und Behandlungspflege, Pflegedokumentation, Patientenversorgung auf der Station',
      '  - Anleitung von Auszubildenden, Zusammenarbeit mit dem ärztlichen Dienst',
      `${developer}   Softwareentwickler, IT-Dienstleister`,
      '  - Webentwicklung mit Java und SQL, Datenbanken, Linux-Server, Git',
      '  - Wartung von Anwendungen für Kunden aus dem Handel und der Industrie',
      'Kenntnisse',
      'Pflegeplanung, Wundversorgung, Java, SQL, Git',
    ].join('\n');

  it('weights the current role more than an old one: same CV, jobs in the other order', () => {
    const nurseNow = domains(nurseThenDeveloper('seit 2019', '2008 – 2014'));
    const developerNow = domains(nurseThenDeveloper('2008 – 2014', 'seit 2019'));
    expect(nurseNow[0]).toBe('healthcare-nursing');
    expect(developerNow[0]).toBe('software-ai');
    expect(nurseNow).toContain('software-ai');
    expect(developerNow).toContain('healthcare-nursing');
  });

  it('lets old roles fade with the configured half-life', () => {
    const text = nurseThenDeveloper('2008 – 2014', 'seit 2019');
    const share = (halfLifeYears: number) => {
      const p = new StructuredCvProfiler(registry(), { ...DEFAULT_CV_ANALYSIS, halfLifeYears }, () => NOW).analyse(text);
      return p.weights.find((w) => w.domain === 'healthcare-nursing')?.weight ?? 0;
    };
    // A long half-life keeps the old nursing job important; a short one lets it fade.
    expect(share(20)).toBeGreaterThan(share(2));
  });
});

describe('CVs that cannot be profiled', () => {
  it('falls back to general for a very short CV', () => {
    const r = analyse('Max Muster, Pflegefachkraft.');
    expect(r).toMatchObject({ source: 'fallback', fallbackReason: 'short', weights: [{ domain: 'general', weight: 100 }] });
    expect(r.notice).toContain('choose your domains by hand');
  });

  it('falls back to general for a CV in another language', () => {
    const french = [
      'Expérience professionnelle',
      '2019 - 2024 Responsable de la logistique pour une entreprise de transport à Lyon, avec une équipe de dix personnes.',
      'Gestion des stocks et des commandes dans le magasin, planification des tournées pour les clients et les fournisseurs.',
      'Formation',
      '2015 - 2019 Licence en gestion, université de Lyon, avec un stage dans une entreprise de commerce international.',
      'Langues: français, anglais, espagnol. Permis de conduire. Centres d’intérêt: la musique et le sport.',
    ].join('\n');
    expect(analyse(french)).toMatchObject({ source: 'fallback', fallbackReason: 'language' });
  });

  it('falls back to general when no field can be recognised', () => {
    const vague = Array.from({ length: 8 }, () => 'Ich arbeite gern im Team und bin zuverlässig, flexibel und motiviert.').join('\n');
    expect(analyse(vague)).toMatchObject({ source: 'fallback', fallbackReason: 'no-match' });
  });

  it('ignores words every field uses, including the user\'s own ignore list', () => {
    const text = Array.from({ length: 6 }, () => 'Projektmanagement im Team, Kommunikation mit Kunden, Dokumentation und Präsentation, Marketing.').join('\n');
    expect(domains(text)[0]).toBe('marketing-media');
    const p = new StructuredCvProfiler(registry(), { ...DEFAULT_CV_ANALYSIS, ignoreWords: ['Marketing'] }, () => NOW);
    expect(p.analyse(text).source).toBe('fallback');
  });
});

describe('reading the CV structure', () => {
  const year = yearOf(NOW);

  it('recognises German and English headings, also combined ones', () => {
    expect(headingOf(foldText('Berufserfahrung'))).toBe('experience');
    expect(headingOf(foldText('BERUFLICHER WERDEGANG:'))).toBe('experience');
    expect(headingOf(foldText('Work Experience'))).toBe('experience');
    expect(headingOf(foldText('Ausbildung & Studium'))).toBe('education');
    expect(headingOf(foldText('Kenntnisse und Fähigkeiten'))).toBe('skills');
    expect(headingOf(foldText('Zertifikate'))).toBe('certifications');
    expect(headingOf(foldText('Sprachen'))).toBe('languages');
    expect(headingOf(foldText('Projekte'))).toBe('projects');
    expect(headingOf(foldText('Entwicklung von Software für Steuergeräte'))).toBeNull();
  });

  it.each([
    ['01/2020 – heute Pflegefachkraft', '2020 to now'],
    ['seit März 2021 Koch', '2021 to now'],
    ['Jan 2019 - Present Developer', '2019 to now'],
    ['2016 - 2020 Entwicklungsingenieur', '2016 to 2020'],
    ['10.2015 – 03.2019 Disponent', '2015 to 2019'],
    ['1.10.2015 bis 31.3.2019 Disponent', '2015 to 2019'],
    ['2019 Bilanzbuchhalter IHK', '2019'],
  ])('reads the dates in "%s"', (line, label) => {
    expect(periodLabel(dateRangeOf(foldText(line), year))).toBe(label);
  });

  it('does not take postal codes, phone numbers or norms for dates', () => {
    for (const line of ['20095 Hamburg', 'Telefon 0151 2345678', 'ISO 26262 und EN 50128']) expect(dateRangeOf(foldText(line), year)).toBeNull();
  });

  it('splits experience into entries with the title next to the dates', () => {
    const parsed = parseCv(cv('chef-de.txt'), year);
    const jobs = parsed.entries.filter((e) => e.section === 'experience');
    expect(jobs.map((j) => periodLabel(j.range))).toEqual(['2021 to now', '2016 to 2021', '2013 to 2016']);
    expect(jobs[1].head).toContain('sous chef');
  });

  it('finds the title above the dates as well', () => {
    const parsed = parseCv(['Berufserfahrung', 'Pflegefachkraft', 'Klinikum Musterstadt', '04/2019 – heute', 'Grundpflege'].join('\n'), year);
    expect(parsed.entries[0].head).toContain('pflegefachkraft');
  });
});

describe('term matching', () => {
  it('finds umlaut plurals and female forms', () => {
    expect(umlautVariant('kraft')).toBe('kraeft');
    expect(umlautVariant('koch')).toBe('koech');
    expect(umlautVariant('frau')).toBeNull();
    const m = new TermMatcher([{ term: 'Pflegefachkraft', weight: 1 }, { term: 'Koch', weight: 1 }, { term: 'Arzt', weight: 1 }]);
    const hits = (t: string) => m.hits(foldText(t)).map((h) => h.term);
    expect(hits('Wir suchen Pflegefachkräfte')).toEqual(['Pflegefachkraft']);
    expect(hits('Pflegefachkraefte gesucht')).toEqual(['Pflegefachkraft']);
    expect(hits('Ausbildung zur Köchin')).toEqual(['Koch']);
    expect(hits('Ärztin in Weiterbildung')).toEqual(['Arzt']);
    expect(hits('Kochrezepte')).toEqual([]);
  });

  it('treats hyphen and space alike and counts spelling variants once', () => {
    const m = new TermMatcher([{ term: 'Kfz-Mechatroniker', weight: 1 }, { term: 'Tier 1', weight: 1 }, { term: 'Tier-1', weight: 2 }]);
    expect(m.hits(foldText('KFZ Mechatroniker und Tier-1-Zulieferer')).map((h) => [h.term, h.weight])).toEqual([
      ['Kfz-Mechatroniker', 1],
      ['Tier 1', 2],
    ]);
  });

  it('finds job titles only at the start of a word', () => {
    const titles = new TermMatcher([{ term: 'Controller', weight: 1 }], new Set(), { wordStart: true });
    expect(titles.hits(foldText('Firmware für einen Microcontroller'))).toEqual([]);
    expect(titles.hits(foldText('Controller im Rechnungswesen'))).toHaveLength(1);
  });
});
