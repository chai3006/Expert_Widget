import { describe, expect, it } from 'vitest';
import { domainOrder, expandEnvVars, expandPath, parseJson, validateConfig, validateEmployers } from '../packages/core/src/config.js';
import { defaultConfigJson, defaultEmployers, registry, appData } from './helpers/config.js';

describe('config validation', () => {
  it('accepts the bundled default config', () => {
    const result = validateConfig(defaultConfigJson(), appData());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.newsMaxAgeDays).toBe(7);
      expect(result.value.sources.find((s) => s.id === 'munich-startup')?.enabled).toBe(false);
      expect(domainOrder(result.value)[0]).toBe('automotive-emobility');
    }
  });

  // Changed on purpose (Phase 5): the built-in sources, signal words and topics live in data/;
  // config.json only switches built-in sources on or off and adds sources and words of its own.
  it('reports each problem with its exact path', () => {
    const raw = defaultConfigJson();
    raw.newsMaxAgeDays = 0;
    raw.sources = [
      { id: 'startbase', enabled: 'yes' },
      {"id":"my-feed","topic":"hiring","name":"Own feed","url":"ftp://example.com","adapter":"rss","enabled":true,"domains":"all"},
      {"id":"my-other-feed","topic":"hiring","name":"Own feed","url":"https://example.com/feed","adapter":"rss","enabled":true,"domains":["automotive-emobility","cooking"]},
      {"id":"my-other-feed","topic":"hiring","name":"Own feed","url":"https://example.com/feed","adapter":"rss","enabled":true,"domains":"all"},
    ];
    // Domain keywords live in data/domains; config.json may only add extra ones to known domains.
    (raw.keywords as Record<string, Record<string, unknown>>).domains = { gardening: ['roses'] };
    const result = validateConfig(raw, appData());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain('newsMaxAgeDays: must be a whole number between 1 and 365');
      expect(result.errors).toContain('sources[0].enabled: must be true or false');
      expect(result.errors).toContain('sources[1].url: must be an http or https URL');
      expect(result.errors).toContain('sources[2].domains[1]: unknown domain "cooking"');
      expect(result.errors).toContain('sources[3].id: "my-other-feed" is used twice');
      expect(result.errors.some((e) => e.startsWith('keywords.domains: unknown domain "gardening"'))).toBe(true);
    }
  });

  it('switches built-in sources and adds own sources and words', () => {
    const raw = defaultConfigJson();
    raw.sources = [{ id: 'munich-startup', enabled: true }, { id: 'startbase', enabled: false, url: 'https://ignored.example' }, {"id":"my-feed","topic":"hiring","name":"Own feed","url":"https://example.com/feed","adapter":"rss","enabled":true,"domains":"all"}];
    (raw.keywords as Record<string, Record<string, unknown>>).tags = { hiring_growth: ['Großauftrag'] };
    const result = validateConfig(raw, appData());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const byId = new Map(result.value.sources.map((src) => [src.id, src]));
    expect(byId.get('munich-startup')?.enabled).toBe(true);
    expect(byId.get('startbase')).toMatchObject({ enabled: false, url: 'https://www.startbase.de/feed/' });
    expect(byId.get('my-feed')?.name).toBe('Own feed');
    expect(result.value.keywords.tags.hiring_growth).toContain('Großauftrag');
    expect(result.value.keywords.tags.hiring_growth).toContain('neue Stellen');
  });

  it('keeps an old config.json with the full source list and keyword lists working', () => {
    const old = { ...defaultConfigJson(), sources: appData().sources.map((src) => ({ ...src, domains: 'all' })), keywords: { tags: appData().news.tags } };
    const result = validateConfig(old, appData());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.sources).toEqual(appData().sources);
  });

  it('rejects an unknown tag and non-object input', () => {
    const raw = defaultConfigJson();
    (raw.keywords as Record<string, Record<string, unknown>>).tags = { hiring_maybe: ['x'] };
    const result = validateConfig(raw, appData());
    expect(!result.ok && result.errors).toContain('keywords.tags: unknown tag "hiring_maybe"');
    expect(validateConfig([], appData()).ok).toBe(false);
    expect(validateConfig(null, appData()).ok).toBe(false);
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
  // Changed on purpose (Phase 4): the starter list moved to data/employers; employers.json is now
  // only for the user's own additions and starts empty.
  it('accepts the bundled (empty) employers.json and the directory with all 30 automotive companies', () => {
    expect(defaultEmployers()).toEqual([]);
    const automotive = appData().employers?.find((d) => d.domain === 'automotive-emobility');
    expect(automotive?.segments).toHaveLength(5);
    expect(automotive?.segments.flatMap((s) => s.companies)).toHaveLength(30);
  });

  it('reports bad entries', () => {
    const result = validateEmployers(
      { segments: [{ domain: 'automotive-emobility', segment: 'X', companies: [{ name: 'A', careerUrl: 'javascript:alert(1)', lastVerified: 'yesterday' }] }] },
      registry(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain('employers.json segments[0].companies[0].careerUrl: must be an http or https URL');
      expect(result.errors).toContain('employers.json segments[0].companies[0].lastVerified: must be empty or a date like 2026-10-10');
    }
  });
});
