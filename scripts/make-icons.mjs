// Generates the app and tray icons (teal rounded square with a white "E") as PNG files,
// with no image dependencies. Run with `npm run icons`; the outputs are committed.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEAL = [0x0f, 0x5c, 0x5c];
const WHITE = [0xff, 0xff, 0xff];

/** Colour of the unit-square point (x, y), or null for transparent. */
function shade(x, y) {
  const r = 0.2; // corner radius
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) return null;
  // Letter E: a vertical stem and three bars.
  const inStem = x >= 0.3 && x <= 0.43 && y >= 0.22 && y <= 0.78;
  const bar = (top, right) => x >= 0.3 && x <= right && y >= top && y <= top + 0.12;
  if (inStem || bar(0.22, 0.72) || bar(0.44, 0.66) || bar(0.66, 0.72)) return WHITE;
  return TEAL;
}

/**
 * macOS menu bar "template" icon: only the letter, black on transparent. macOS recolours template
 * images for light and dark menu bars (the file name must end in Template).
 */
function templateShade(x, y) {
  const inStem = x >= 0.2 && x <= 0.38 && y >= 0.12 && y <= 0.88;
  const bar = (top, right) => x >= 0.2 && x <= right && y >= top && y <= top + 0.16;
  return inStem || bar(0.12, 0.8) || bar(0.42, 0.72) || bar(0.72, 0.8) ? [0, 0, 0] : null;
}

function render(size, shadeAt = shade) {
  const ss = 4; // supersampling for smooth edges
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0; // filter: none
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = shadeAt((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size);
          if (c) {
            r += c[0];
            g += c[1];
            b += c[2];
            a += 1;
          }
        }
      }
      const o = py * (size * 4 + 1) + 1 + px * 4;
      raw[o] = a ? Math.round(r / a) : 0;
      raw[o + 1] = a ? Math.round(g / a) : 0;
      raw[o + 2] = a ? Math.round(b / a) : 0;
      raw[o + 3] = Math.round((a / (ss * ss)) * 255);
    }
  }
  return png(size, raw);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outputs = {
  'build/icon.png': 512, // the macOS build needs at least 512x512
  'assets/icon.png': 256,
  'assets/tray.png': 16,
  'assets/tray@2x.png': 32,
  'assets/trayTemplate.png': [16, templateShade],
  'assets/trayTemplate@2x.png': [32, templateShade],
};
for (const [file, spec] of Object.entries(outputs)) {
  const [size, shadeAt] = Array.isArray(spec) ? spec : [spec, shade];
  const path = join(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, render(size, shadeAt));
  console.log(`wrote ${file} (${size}x${size})`);
}
