// Downloads the German→English translation model (Mozilla's Firefox Translations "tiny" de→en
// model, MPL-2.0) into assets/translation/deen/ and checks every file against its SHA-256 hash.
// Runs as part of `npm run compile`; does nothing when the files are already there and correct.
// The widget itself never downloads anything for translation: the model ships with the app.
//
// If the download fails (for example offline), the build continues and the widget simply shows
// the original German texts with a short note.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'assets', 'translation', 'deen');
const BASE = 'https://storage.googleapis.com/bergamot-models-sandbox/0.3.3/deen/';

// Hashes from the Bergamot model registry (0.3.3) and Mozilla's firefox-translations-models
// metadata for models/tiny/deen.
const FILES = {
  'model.deen.intgemm.alphas.bin': '1980225d00dc5645491777accff5b3c9d20b92eff67a25135f1cf8fe2ed8fb8f',
  'lex.50.50.deen.s2t.bin': '2f7c0f7bbce97ae5b52454074a892ba7b7610fb98e3c5d341e4ca79f0850c4de',
  'vocab.deen.spm': '417668f2ed297970febafb5b079a9d5ebc4ed0b3550ac8386d67a90473a09bd7',
};

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

mkdirSync(dir, { recursive: true });
let failed = false;
for (const [name, hash] of Object.entries(FILES)) {
  const target = join(dir, name);
  if (existsSync(target) && sha256(readFileSync(target)) === hash) continue;
  process.stdout.write(`Downloading translation model file ${name} … `);
  try {
    const res = await fetch(BASE + name, { headers: { 'User-Agent': 'ExpertWidget-Build (downloads the offline translation model)' }, signal: AbortSignal.timeout(180_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (sha256(buf) !== hash) throw new Error('checksum does not match');
    writeFileSync(`${target}.tmp`, buf);
    renameSync(`${target}.tmp`, target);
    console.log(`ok (${(buf.length / 1e6).toFixed(1)} MB)`);
  } catch (err) {
    failed = true;
    console.log(`failed: ${err instanceof Error ? err.message : err}`);
  }
}
if (failed) console.warn('The English translation will not be available until the model is downloaded (run npm run compile again when online).');
