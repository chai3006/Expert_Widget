import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CV_ANALYSIS } from '../packages/core/src/config.js';
import { StructuredCvProfiler } from '../packages/core/src/cv/structuredProfiler.js';
import { validateDomain } from '../packages/core/src/domains.js';
import { foldText } from '../packages/core/src/text/keywords.js';
import { GENERIC_WORDS } from '../packages/core/src/text/terms.js';
import { loadDomainRegistry } from '../packages/node/src/appData.js';
import { ROOT, registry } from './helpers/config.js';

const DIR = join(ROOT, 'data', 'domains');
const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
const schema = new Ajv2020({ allErrors: true, strict: true }).compile(JSON.parse(readFileSync(join(ROOT, 'data', 'domains.schema.json'), 'utf8')));

const LEGACY_IDS = [
  'automotive-emobility', 'semiconductors', 'embedded-iot', 'industrial-automation', 'energy-storage', 'aerospace-defense',
  'machinery-household', 'medtech', 'rail-transport', 'telecom', 'software-ai', 'civil-chemical',
];

describe('domain files', () => {
  it.each(files)('%s is valid', (file) => {
    const raw = JSON.parse(readFileSync(join(DIR, file), 'utf8'));
    expect(schema(raw) ? [] : schema.errors).toEqual([]);
    const result = validateDomain(raw, file.replace(/\.json$/, ''));
    expect(result.ok ? [] : result.errors).toEqual([]);
  });

  it.each(files)('%s uses no word that every CV contains', (file) => {
    const raw = JSON.parse(readFileSync(join(DIR, file), 'utf8'));
    const terms = [...raw.keywords, ...raw.titles, ...raw.education].map((t: string | { term: string }) => foldText(typeof t === 'string' ? t : t.term));
    expect(terms.filter((t: string) => GENERIC_WORDS.includes(t))).toEqual([]);
  });

  it('keeps the 12 original ids and has one general fallback, about 30 domains in all', () => {
    const r = registry();
    for (const id of LEGACY_IDS) expect(r.has(id), id).toBe(true);
    expect(r.fallback.id).toBe('general');
    expect(r.ids.length).toBeGreaterThanOrEqual(25);
    expect(r.ids.length).toBeLessThanOrEqual(32);
    expect(r.ids[r.ids.length - 1]).toBe('general');
    expect(r.ids.slice(0, 12)).toEqual(LEGACY_IDS);
  });

  it('covers the main fields of work in Germany', () => {
    for (const id of [
      'software-ai', 'construction-architecture', 'healthcare-nursing', 'pharma-life-sciences', 'finance-banking-insurance', 'accounting-tax',
      'law-compliance', 'consulting', 'sales-retail-ecommerce', 'marketing-media', 'logistics-supply-chain', 'hospitality-tourism',
      'education-research', 'public-sector', 'hr-recruiting', 'skilled-trades', 'agriculture-food', 'creative-design',
    ]) {
      expect(registry().has(id), id).toBe(true);
    }
  });

  it('reports a broken file with its name', () => {
    expect(validateDomain({ schemaVersion: 1, id: 'x' }, 'y')).toMatchObject({ ok: false });
    const r = validateDomain({ schemaVersion: 1, id: 'wrong', order: 1, sector: 'a', label: { de: 'a', en: 'a' }, shortLabel: { de: 'a', en: 'a' }, description: 'd', keywords: ['k', 'K'], titles: [], education: [] }, 'right');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toContain('right.json id: "wrong" must match the file name');
      expect(r.errors).toContain('right.json keywords[1]: "K" is listed twice');
    }
  });
});

describe('adding a domain', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'expert-domains-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('needs only a new data file', async () => {
    cpSync(DIR, dir, { recursive: true });
    writeFileSync(
      join(dir, 'maritime.json'),
      JSON.stringify({
        schemaVersion: 1,
        id: 'maritime',
        order: 305,
        sector: 'trade',
        label: { de: 'Schifffahrt & Häfen', en: 'Shipping & ports' },
        shortLabel: { de: 'Schifffahrt', en: 'Shipping' },
        description: 'Shipping companies, ports and shipyards.',
        keywords: ['Reederei', 'Hafen', 'Containerschiff', 'Werft'],
        titles: ['Kapitän', 'Schiffsmechaniker', 'Nautischer Offizier'],
        education: ['Nautik', 'Schiffbau'],
      }),
    );
    const loaded = loadDomainRegistry(dir);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.ids).toContain('maritime');
    const cv = [
      'Berufserfahrung',
      'seit 2019  Nautischer Offizier bei einer Reederei in Hamburg',
      'Navigation von Containerschiffen, Wachdienst, Ladungssicherung im Hafen und auf See.',
      '2014 - 2019  Schiffsmechaniker, Reederei',
      'Wartung der Maschinenanlage, Arbeiten in der Werft, Hafenliegezeiten und Ladungsarbeiten.',
      'Ausbildung',
      '2010 - 2014  Studium der Nautik, Hochschule für Seefahrt',
    ].join('\n');
    const profile = new StructuredCvProfiler(loaded.value, DEFAULT_CV_ANALYSIS, () => new Date(2026, 9, 1).getTime()).analyse(cv);
    expect(profile.weights[0].domain).toBe('maritime');
  });
});
