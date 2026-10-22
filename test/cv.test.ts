import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { domainOrder } from '../packages/core/src/config.js';
import { findCv } from '../packages/node/src/cv/cvFiles.js';
import { computeDomainMix, RuleBasedCvProfiler } from '../packages/core/src/cv/cvProfiler.js';
import { CvReadError, decodeText, extractCvText } from '../packages/node/src/cv/extract.js';
import { LocalCvProvider } from '../packages/node/src/cv/folderCvSource.js';
import type { DomainId } from '../packages/core/src/shared/types.js';
import { defaultConfig, fixture } from './helpers/config.js';
import { makeDocx, makePdf } from './helpers/docs.js';

const config = defaultConfig();
const profiler = new RuleBasedCvProfiler(config.keywords.domains, domainOrder(config));
const sum = (ws: Array<{ weight: number }>) => ws.reduce((a, w) => a + w.weight, 0);

describe('domain mix from keyword hits', () => {
  it('turns hits into whole-number shares summing to 100', () => {
    const mix = computeDomainMix(new Map<DomainId, number>([['automotive-emobility', 6], ['embedded-iot', 3], ['energy-storage', 1]]), domainOrder(config));
    expect(mix).toEqual([
      { domain: 'automotive-emobility', weight: 60 },
      { domain: 'embedded-iot', weight: 30 },
      { domain: 'energy-storage', weight: 10 },
    ]);
  });

  it('drops domains below 5 % and re-normalises', () => {
    const mix = computeDomainMix(new Map<DomainId, number>([['automotive-emobility', 50], ['embedded-iot', 46], ['medtech', 4]]), domainOrder(config));
    expect(mix.map((m) => m.domain)).toEqual(['automotive-emobility', 'embedded-iot']);
    expect(sum(mix)).toBe(100);
    expect(mix[0].weight).toBe(52);
  });

  it('keeps at most 4 domains', () => {
    const hits = new Map<DomainId, number>([['automotive-emobility', 20], ['embedded-iot', 19], ['energy-storage', 18], ['software-ai', 17], ['telecom', 16]]);
    const mix = computeDomainMix(hits, domainOrder(config));
    expect(mix).toHaveLength(4);
    expect(mix.some((m) => m.domain === 'telecom')).toBe(false);
    expect(sum(mix)).toBe(100);
  });

  it('breaks ties by domain order in the config', () => {
    const order = domainOrder(config);
    const tie = computeDomainMix(new Map<DomainId, number>([['software-ai', 1], ['semiconductors', 1], ['medtech', 1]]), order);
    // 33.33 each: the extra point goes to the earliest domain in the config.
    expect(tie).toEqual([
      { domain: 'semiconductors', weight: 34 },
      { domain: 'medtech', weight: 33 },
      { domain: 'software-ai', weight: 33 },
    ]);
    const fiveWay = computeDomainMix(
      new Map<DomainId, number>([['telecom', 1], ['medtech', 1], ['semiconductors', 1], ['software-ai', 1], ['rail-transport', 1]]),
      order,
    );
    expect(fiveWay.map((m) => m.domain)).toEqual(['semiconductors', 'medtech', 'rail-transport', 'telecom']);
    expect(fiveWay.map((m) => m.weight)).toEqual([25, 25, 25, 25]);
  });

  it('returns an empty mix when nothing matches', () => {
    expect(computeDomainMix(new Map(), domainOrder(config))).toEqual([]);
  });
});

describe('rule-based CV profiler', () => {
  it('profiles the English fixture CV as automotive / embedded led', async () => {
    const mix = await profiler.computeWeights(fixture('cv', 'cv-en.txt'));
    expect(mix[0].domain).toBe('automotive-emobility');
    expect(mix.map((m) => m.domain)).toContain('embedded-iot');
    expect(mix.length).toBeLessThanOrEqual(4);
    expect(sum(mix)).toBe(100);
  });

  it('profiles the German fixture CV as machinery led with automation second', async () => {
    const mix = await profiler.computeWeights(fixture('cv', 'cv-de.txt'));
    expect(mix[0].domain).toBe('machinery-household');
    expect(mix[1].domain).toBe('industrial-automation');
    expect(sum(mix)).toBe(100);
  });

  it('matches short acronyms only as whole words', () => {
    const hits = profiler.scoreHits('We can talk about the ECU. Ecuador is not one.');
    expect(hits.get('automotive-emobility')).toBe(1);
  });
});

describe('CV folder', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'expert-cv-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reports an empty folder', async () => {
    expect(await findCv(dir)).toEqual({ kind: 'empty', folder: dir });
  });

  it('creates the folder when missing', async () => {
    const missing = join(dir, 'Documents', 'ExpertWidget', 'CV');
    expect((await findCv(missing)).kind).toBe('empty');
  });

  it('refuses to guess between several CV files', async () => {
    writeFileSync(join(dir, 'cv-de.pdf'), 'x');
    writeFileSync(join(dir, 'cv-en.docx'), 'x');
    const result = await findCv(dir);
    expect(result).toEqual({ kind: 'multiple', folder: dir, fileNames: ['cv-de.pdf', 'cv-en.docx'] });
  });

  it('ignores other files, hidden files and Word lock files', async () => {
    writeFileSync(join(dir, 'Lebenslauf.DOCX'), 'x');
    writeFileSync(join(dir, '~$Lebenslauf.docx'), 'x');
    writeFileSync(join(dir, 'photo.jpg'), 'x');
    writeFileSync(join(dir, '.notes.txt'), 'x');
    const result = await findCv(dir);
    expect(result.kind === 'ok' && result.fileName).toBe('Lebenslauf.DOCX');
  });

  it('the provider names the folder when there is no CV or several', async () => {
    const provider = new LocalCvProvider();
    const none = await provider.readProfile(config, dir);
    expect(!none.ok && none.problem).toContain(dir);
    writeFileSync(join(dir, 'a.txt'), 'x');
    writeFileSync(join(dir, 'b.txt'), 'x');
    const several = await provider.readProfile(config, dir);
    expect(!several.ok && several.problem).toMatch(/Found 2 CV files .* Keep exactly one/);
  });

  it('the provider stores file name and modified time, never the text', async () => {
    writeFileSync(join(dir, 'cv.txt'), fixture('cv', 'cv-en.txt'));
    const result = await new LocalCvProvider(undefined, () => 42).readProfile(config, dir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Since the domain registry (Phase 2) the profile also keeps short evidence labels: terms
      // from data/domains such as "AUTOSAR", never text copied from the CV.
      expect(Object.keys(result.profile).sort()).toEqual(['computedAt', 'evidence', 'fileName', 'modifiedMs', 'notice', 'sizeBytes', 'source', 'weights']);
      expect(result.profile.fileName).toBe('cv.txt');
      const stored = JSON.stringify(result.profile);
      for (const cvText of ['Jane', 'Infineon', 'Stuttgart', 'eight years', 'test automation']) expect(stored).not.toContain(cvText);
    }
  });
});

describe('CV text extraction', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'expert-extract-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reads a PDF', async () => {
    const path = join(dir, 'cv.pdf');
    writeFileSync(path, makePdf(['Embedded Software Engineer', 'AUTOSAR, Steuergerät, Elektromobilität']));
    const text = await extractCvText(path);
    expect(text).toContain('AUTOSAR');
    expect(text).toContain('Steuergerät');
    expect(text).not.toMatch(/-- 1 of 1 --/);
  });

  it('reads a DOCX', async () => {
    const path = join(dir, 'cv.docx');
    writeFileSync(path, makeDocx(['Konstruktionsingenieur Maschinenbau', 'SPS-Programmierung im TIA Portal']));
    const text = await extractCvText(path);
    expect(text).toContain('Konstruktionsingenieur Maschinenbau');
    expect(text).toContain('TIA Portal');
  });

  it('reads UTF-8, UTF-16 and Windows-1252 text files', async () => {
    expect(decodeText(Buffer.from('\uFEFFMüller Größe', 'utf8'))).toBe('Müller Größe');
    expect(decodeText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Müller', 'utf16le')]))).toBe('Müller');
    expect(decodeText(Buffer.from([0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72]))).toBe('Müller');
  });

  it('rejects an empty file', async () => {
    const path = join(dir, 'cv.txt');
    writeFileSync(path, '');
    await expect(extractCvText(path)).rejects.toThrow(new CvReadError('the file is empty'));
  });

  it('rejects an unreadable PDF and DOCX with a clear reason', async () => {
    const pdf = join(dir, 'cv.pdf');
    writeFileSync(pdf, 'this is not a pdf at all');
    await expect(extractCvText(pdf)).rejects.toThrow(/the PDF could not be read/);
    const docx = join(dir, 'cv.docx');
    writeFileSync(docx, 'not a zip');
    await expect(extractCvText(docx)).rejects.toThrow(/the Word document could not be read/);
  });

  it('rejects a PDF without text (scanned image)', async () => {
    const path = join(dir, 'cv.pdf');
    writeFileSync(path, makePdf([]));
    await expect(extractCvText(path)).rejects.toThrow(/no text found in the PDF/);
  });

  it('the provider keeps the reason when the CV cannot be read', async () => {
    writeFileSync(join(dir, 'cv.pdf'), 'garbage');
    const result = await new LocalCvProvider().readProfile(config, dir);
    expect(!result.ok && result.problem).toMatch(/^Could not read cv\.pdf: the PDF could not be read/);
  });
});
