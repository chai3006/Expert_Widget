// Every way the CV can fail to load has a plain message with the next step (Phase 3).

import { mkdirSync, mkdtempSync, promises as fsp, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runRefresh, type CvProvider } from '../packages/core/src/refresh.js';
import { memoryStores } from '../packages/core/src/state/appState.js';
import { MAX_CV_BYTES } from '../packages/node/src/cv/extract.js';
import { FolderCvSource, LocalCvProvider } from '../packages/node/src/cv/folderCvSource.js';
import { LEGACY_DEFAULT_CV_FOLDER, cvFolderFor, resolveHome, userFiles } from '../packages/node/src/userFiles.js';
import { defaultConfig, fixture } from './helpers/config.js';
import { makeEncryptedPdf, makePdf } from './helpers/docs.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'expert-cvp-'));
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

async function problem(): Promise<{ kind?: string; problem: string }> {
  const r = await new FolderCvSource(dir).read();
  if (r.ok) throw new Error('expected a problem');
  return r;
}

describe('CV problems', () => {
  it('no file: names the folder and says what to put there', async () => {
    const p = await problem();
    expect(p.kind).toBe('no-file');
    expect(p.problem).toContain(dir);
    expect(p.problem).toMatch(/\.pdf, \.docx or \.txt.*press Refresh/);
  });

  it('more than one file: asks to keep exactly one', async () => {
    writeFileSync(join(dir, 'a.pdf'), 'x');
    writeFileSync(join(dir, 'b.docx'), 'x');
    expect(await problem()).toMatchObject({ kind: 'multiple', problem: expect.stringMatching(/Found 2 CV files .* Keep exactly one and press Refresh/) });
  });

  it('unsupported type: names the file and the formats that work', async () => {
    writeFileSync(join(dir, 'Lebenslauf.doc'), 'x');
    const p = await problem();
    expect(p).toMatchObject({ kind: 'unsupported', problem: expect.stringContaining('Lebenslauf.doc') });
    expect(p.problem).toContain('.pdf, .docx and .txt');
  });

  it('password-protected PDF', async () => {
    writeFileSync(join(dir, 'cv.pdf'), makeEncryptedPdf());
    expect(await problem()).toMatchObject({ kind: 'password', problem: expect.stringMatching(/protected with a password\. Save a copy without a password/) });
  });

  it('scanned PDF without text', async () => {
    writeFileSync(join(dir, 'cv.pdf'), makePdf([]));
    expect(await problem()).toMatchObject({ kind: 'scanned', problem: expect.stringContaining('probably a scan') });
  });

  it('empty text', async () => {
    writeFileSync(join(dir, 'cv.txt'), '   \n\n   ');
    expect(await problem()).toMatchObject({ kind: 'empty' });
  });

  it('huge file', async () => {
    writeFileSync(join(dir, 'cv.pdf'), Buffer.alloc(MAX_CV_BYTES + 1));
    expect(await problem()).toMatchObject({ kind: 'too-large', problem: expect.stringContaining('larger than 20 MB') });
  });

  it('locked file', async () => {
    writeFileSync(join(dir, 'cv.txt'), fixture('cv', 'cv-en.txt'));
    vi.spyOn(fsp, 'readFile').mockRejectedValue(Object.assign(new Error('busy'), { code: 'EBUSY' }));
    expect(await problem()).toMatchObject({ kind: 'locked', problem: expect.stringContaining('Close it in the other program') });
  });

  it('no permission on the folder', async () => {
    vi.spyOn(fsp, 'readdir').mockRejectedValue(Object.assign(new Error('denied'), { code: 'EACCES' }));
    expect(await problem()).toMatchObject({ kind: 'no-permission', problem: expect.stringContaining('Choose another folder') });
  });

  it('keeps the problem kind for the welcome screen', async () => {
    const stores = memoryStores();
    const cv: CvProvider = { readProfile: async () => ({ ok: false, problem: 'No CV found.', kind: 'no-file' }) };
    await runRefresh({ config: defaultConfig(), cvFolder: dir, stores, cv, providers: [], isOnline: () => true, now: () => 1, mock: false });
    expect(stores.profile.value).toMatchObject({ profile: null, lastProblem: 'No CV found.', lastProblemKind: 'no-file' });
  });
});

describe('a replaced CV', () => {
  it('is noticed by name, size or modified time and replaces the old profile', async () => {
    const stores = memoryStores();
    const config = defaultConfig();
    writeFileSync(join(dir, 'cv.txt'), fixture('cv', 'fields', 'nurse-de.txt'));
    const cv = new LocalCvProvider(undefined, () => new Date(2026, 9, 1).getTime());
    const refresh = () => runRefresh({ config, cvFolder: dir, stores, cv, providers: [], isOnline: () => true, now: () => 2, mock: false });
    expect(await refresh()).toEqual([]);
    expect(stores.profile.value.profile?.weights[0].domain).toBe('healthcare-nursing');
    expect(await refresh()).toEqual([]);
    rmSync(join(dir, 'cv.txt'));
    writeFileSync(join(dir, 'Lebenslauf-neu.txt'), fixture('cv', 'fields', 'chef-de.txt'));
    const messages = await refresh();
    expect(messages).toEqual([{ level: 'info', text: 'Read your new CV Lebenslauf-neu.txt. The domain mix was computed again.' }]);
    expect(stores.profile.value.profile).toMatchObject({ fileName: 'Lebenslauf-neu.txt', weights: [{ domain: 'hospitality-tourism' }] });
  });
});

describe('where the files live', () => {
  it('uses ExpertWidget in the system Documents folder', () => {
    expect(resolveHome({}, join(dir, 'OneDrive', 'Dokumente'), join(dir, 'home'))).toBe(join(dir, 'OneDrive', 'Dokumente', 'ExpertWidget'));
    expect(resolveHome({ EXPERT_WIDGET_HOME: join(dir, 'x') }, join(dir, 'Docs'))).toBe(join(dir, 'x'));
  });

  it('keeps using the folder of earlier versions when it already has a config.json', () => {
    const legacy = join(dir, 'home', 'Documents', 'ExpertWidget');
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, 'config.json'), '{}');
    expect(resolveHome({}, join(dir, 'OneDrive', 'Dokumente'), join(dir, 'home'))).toBe(legacy);
  });

  it('puts the CV folder next to config.json unless config.json names another one', () => {
    const files = userFiles(join(dir, 'ExpertWidget'));
    expect(cvFolderFor(files, '', {}, dir)).toBe(join(dir, 'ExpertWidget', 'CV'));
    expect(cvFolderFor(files, LEGACY_DEFAULT_CV_FOLDER, {}, dir)).toBe(join(dir, 'ExpertWidget', 'CV'));
    expect(cvFolderFor(files, join(dir, 'elsewhere'), {}, dir)).toBe(join(dir, 'elsewhere'));
  });
});
