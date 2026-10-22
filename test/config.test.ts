import { describe, expect, it } from 'vitest';
import { domainOrder, expandEnvVars, expandPath, parseJson, validateConfig, validateEmployers } from '../packages/core/src/config.js';
import { defaultConfigJson, defaultEmployers } from './helpers/config.js';

describe('config validation', () => {
  it('accepts the bundled default config', () => {
    const result = validateConfig(defaultConfigJson());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.newsMaxAgeDays).toBe(7);
      expect(result.value.sources.find((s) => s.id === 'munich-startup')?.enabled).toBe(false);
      expect(domainOrder(result.value)[0]).toBe('automotive-emobility');
    }
  });

  it('reports each problem with its exact path', () => {
    const raw = defaultConfigJson();
    raw.newsMaxAgeDays = 0;
    (raw.sources as Array<Record<string, unknown>>)[1].url = 'ftp://example.com';
    (raw.sources as Array<Record<string, unknown>>)[2].domains = ['automotive-emobility', 'cooking'];
    (raw.sources as Array<Record<string, unknown>>)[3].id = 'ingenieur-recruiting-tag';
    (raw.keywords as Record<string, Record<string, unknown>>).domains.gardening = ['roses'];
    const result = validateConfig(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain('newsMaxAgeDays: must be a whole number between 1 and 365');
      expect(result.errors).toContain('sources[1].url: must be an http or https URL');
      expect(result.errors).toContain('sources[2].domains[1]: unknown domain "cooking"');
      expect(result.errors).toContain('sources[3].id: "ingenieur-recruiting-tag" is used twice');
      expect(result.errors.some((e) => e.startsWith('keywords.domains: unknown domain "gardening"'))).toBe(true);
    }
  });

  it('rejects a missing tag keyword list and non-object input', () => {
    const raw = defaultConfigJson();
    delete (raw.keywords as Record<string, Record<string, unknown>>).tags.hiring_cuts;
    const result = validateConfig(raw);
    expect(!result.ok && result.errors).toContain('keywords.tags.hiring_cuts: missing');
    expect(validateConfig([]).ok).toBe(false);
    expect(validateConfig(null).ok).toBe(false);
  });

  it('reports JSON syntax errors with a line number', () => {
    const result = parseJson('{\n  "cvFolder": "x",\n  oops\n}', 'config.json');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/^config\.json is not valid JSON \(line 3\)/);
  });

  it('accepts a UTF-8 BOM', () => {
    expect(parseJson('\uFEFF{"a":1}', 'x.json')).toEqual({ ok: true, value: { a: 1 } });
  });

  it('expands %USERPROFILE% case-insensitively and leaves unknown variables alone', () => {
    expect(expandEnvVars('%userprofile%\\Documents\\ExpertWidget\\CV', { USERPROFILE: 'C:\\Users\\me' })).toBe('C:\\Users\\me\\Documents\\ExpertWidget\\CV');
    expect(expandEnvVars('%NOPE%\\x', {})).toBe('%NOPE%\\x');
  });

  it('turns cvFolder into a path on Windows, macOS and Linux', () => {
    // The bundled default works everywhere.
    expect(expandPath('~/Documents/ExpertWidget/CV', {}, 'C:\\Users\\me', 'win32')).toBe('C:\\Users\\me/Documents/ExpertWidget/CV');
    expect(expandPath('~/Documents/ExpertWidget/CV', {}, '/Users/me', 'darwin')).toBe('/Users/me/Documents/ExpertWidget/CV');
    expect(expandPath('~', {}, '/home/me', 'linux')).toBe('/home/me');
    // $VAR and ${VAR} outside Windows; unknown ones are left alone.
    expect(expandPath('$HOME/cv', { HOME: '/home/me' }, '/home/me', 'linux')).toBe('/home/me/cv');
    expect(expandPath('${XDG_DOCUMENTS_DIR}/cv', { XDG_DOCUMENTS_DIR: '/data/docs' }, '/home/me', 'linux')).toBe('/data/docs/cv');
    expect(expandPath('$NOPE/cv', {}, '/home/me', 'linux')).toBe('$NOPE/cv');
    // A config.json from a Windows PC keeps working on a Mac.
    expect(expandPath('%USERPROFILE%\\Documents\\ExpertWidget\\CV', {}, '/Users/me', 'darwin')).toBe('/Users/me/Documents/ExpertWidget/CV');
    // Windows paths are left as they are on Windows.
    expect(expandPath('%USERPROFILE%\\CV', { USERPROFILE: 'C:\\Users\\me' }, 'C:\\Users\\me', 'win32')).toBe('C:\\Users\\me\\CV');
    expect(expandPath('D:\\CV $x', {}, 'C:\\Users\\me', 'win32')).toBe('D:\\CV $x');
  });
});

describe('employers validation', () => {
  it('accepts the bundled employers', () => {
    const employers = defaultEmployers();
    expect(employers).toHaveLength(5);
    expect(employers.flatMap((s) => s.companies)).toHaveLength(30);
  });

  it('reports bad entries', () => {
    const result = validateEmployers({
      segments: [{ domain: 'automotive-emobility', segment: 'X', companies: [{ name: 'A', careerUrl: 'javascript:alert(1)', lastVerified: 'yesterday' }] }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain('employers.json segments[0].companies[0].careerUrl: must be an http or https URL');
      expect(result.errors).toContain('employers.json segments[0].companies[0].lastVerified: must be empty or a date like 2026-10-10');
    }
  });
});
