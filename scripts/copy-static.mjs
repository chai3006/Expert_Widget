// Copies the renderer's static files (HTML, CSS, fonts) next to the compiled renderer scripts.
import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src', 'renderer');
const out = join(root, 'dist', 'ui', 'renderer');
mkdirSync(out, { recursive: true });

for (const entry of readdirSync(src, { withFileTypes: true })) {
  if (entry.isDirectory() || /\.(html|css)$/.test(entry.name)) {
    cpSync(join(src, entry.name), join(out, entry.name), { recursive: true });
  }
}
