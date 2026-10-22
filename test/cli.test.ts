import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULTS_DIR, cliFiles, main, parseArgs } from '../packages/cli/src/cli.js';
import { ROOT } from './helpers/config.js';
import { schemaErrors } from './helpers/schemas.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'expert-cli-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const SECRET = 'Musterstrasse 12, 80331 Muenchen, Telefon 0151 2345678';
const CV = [
  'Erika Beispiel',
  SECRET,
  'Berufserfahrung',
  'seit 04/2021  Embedded-Softwareentwicklerin, Automobilzulieferer in Bayern',
  'Entwicklung von Software für Steuergeräte nach AUTOSAR, Kommunikation über CAN-Bus und CAN FD.',
  'Firmware für Mikrocontroller in der Elektromobilität, funktionale Sicherheit nach ISO 26262.',
  'Batteriemanagement (BMS) für Traktionsbatterien, Test am Hardware-in-the-Loop-Prüfstand.',
  '2017 - 2021  Softwareentwicklerin, Ingenieurdienstleister',
  'Fahrerassistenz und Antriebsstrang für einen Fahrzeughersteller, MISRA C, Yocto.',
  'Ausbildung',
  '2012 - 2017  Studium Elektrotechnik, Technische Universität',
].join('\n');

async function run(args: string[]): Promise<{ code: number; out: string }> {
  let out = '';
  const code = await main(args, (s) => {
    out += s;
  });
  return { code, out };
}

describe('expert-cli', () => {
  it('finds the bundled defaults', () => {
    expect(DEFAULTS_DIR).toBe(join(ROOT, 'defaults'));
    expect(cliFiles(null).configPath).toBe(join(ROOT, 'defaults', 'config.json'));
  });

  it('prints the data payload as JSON without any CV text', async () => {
    const cv = join(dir, 'Lebenslauf.txt');
    writeFileSync(cv, CV, 'utf8');
    const { code, out } = await run(['--cv', cv, '--no-network', '--json']);
    expect(code).toBe(0);
    const data = JSON.parse(out);
    expect(schemaErrors('DomainProfile', data.profile)).toEqual([]);
    expect(data.profile.weights.map((w: { domain: string }) => w.domain).slice(0, 2).sort()).toEqual(['automotive-emobility', 'embedded-iot']);
    expect(data.employers.find((d: { domain: string }) => d.domain === 'automotive-emobility').segments.length).toBeGreaterThan(0);
    expect(data.news).toEqual([]);
    expect(out).not.toContain('Musterstrasse');
    expect(out).not.toContain('Erika');
    expect(out).not.toContain('Lebenslauf');
  });

  it('uses the files of --config and keeps state in --state', async () => {
    const cv = join(dir, 'cv.txt');
    writeFileSync(cv, CV, 'utf8');
    writeFileSync(join(dir, 'watchlist.json'), JSON.stringify({ companies: [{ name: 'Beispiel GmbH' }] }), 'utf8');
    const state = join(dir, 'state');
    const { code } = await run(['--cv', cv, '--config', dir, '--state', state, '--no-network']);
    expect(code).toBe(0);
    expect(cliFiles(dir).watchlistPath).toBe(join(dir, 'watchlist.json'));
    expect(cliFiles(dir).configPath).toBe(join(ROOT, 'defaults', 'config.json'));
  });

  it('exits with 1 and a plain message when the CV cannot be read', async () => {
    const { code, out } = await run(['--cv', join(dir, 'missing.pdf'), '--no-network']);
    expect(code).toBe(1);
    expect(out).toContain('Cannot open');
  });

  it('explains wrong arguments', async () => {
    expect(parseArgs([])).toEqual({ error: '--cv <file> is required' });
    expect(parseArgs(['--cv'])).toEqual({ error: '--cv needs a value' });
    expect(parseArgs(['--cv', 'a.pdf', '--colour'])).toEqual({ error: 'unknown option --colour' });
    const { code, out } = await run(['--bogus']);
    expect(code).toBe(2);
    expect(out).toContain('Usage: expert-cli');
  });
});
