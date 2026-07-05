// Generate the extension icons (shield on a U of T navy rounded square).
// Zero-dependency: renders PNGs directly via a minimal PNG encoder (node:zlib)
// and emits matching SVG sources from the same geometry.
//
// Run: node generate-icons.mjs
// Outputs: icon-{16,48,128}.png and icon-{16,48,128}.svg

import { writeFileSync } from 'fs';
import { deflateSync } from 'zlib';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// Write next to this script regardless of the caller's cwd.
const OUT_DIR = dirname(fileURLToPath(import.meta.url));

const SIZES = [16, 48, 128];
const NAVY = [0, 42, 92]; // #002A5C — U of T blue
const SHIELD_FILL = [232, 236, 242]; // soft white

// Shield outline in unit coordinates (top-left origin). Flat top, curved
// sides tapering to a bottom point — matches the shipped icon design.
const SHIELD = [
  [0.26, 0.20], [0.74, 0.20], // top edge
  [0.74, 0.50],
  [0.715, 0.60], [0.66, 0.69], [0.585, 0.765], [0.50, 0.82], // right curve to tip
  [0.415, 0.765], [0.34, 0.69], [0.285, 0.60], [0.26, 0.50], // left curve back up
];

const CORNER_RADIUS = 0.15; // rounded-square corner radius (fraction of size)

function inRoundedSquare(x, y) {
  const r = CORNER_RADIUS;
  if (x < 0 || x > 1 || y < 0 || y > 1) return false;
  const cx = Math.max(r - x, x - (1 - r), 0);
  const cy = Math.max(r - y, y - (1 - r), 0);
  return cx * cx + cy * cy <= r * r;
}

function inShield(x, y) {
  // Ray casting against the shield polygon.
  let inside = false;
  for (let i = 0, j = SHIELD.length - 1; i < SHIELD.length; j = i++) {
    const [xi, yi] = SHIELD[i];
    const [xj, yj] = SHIELD[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function render(size) {
  const SS = 4; // supersampling factor (anti-aliasing)
  const rgba = new Uint8ClampedArray(size * size * 4);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let bgHits = 0;
      let shieldHits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size;
          const y = (py + (sy + 0.5) / SS) / size;
          if (inRoundedSquare(x, y)) {
            bgHits++;
            if (inShield(x, y)) shieldHits++;
          }
        }
      }
      const total = SS * SS;
      const bgCov = bgHits / total;
      const shieldCov = shieldHits / total;
      if (bgCov === 0) continue; // transparent

      // navy base, shield fill blended on top
      const i = (py * size + px) * 4;
      for (let c = 0; c < 3; c++) {
        const base = NAVY[c] * (1 - shieldCov / Math.max(bgCov, 1e-9)) +
          SHIELD_FILL[c] * (shieldCov / Math.max(bgCov, 1e-9));
        rgba[i + c] = Math.round(base);
      }
      rgba[i + 3] = Math.round(bgCov * 255);
    }
  }
  return rgba;
}

// --- Minimal PNG encoder (RGBA8, no interlace) ---

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // compression 0, filter 0, interlace 0

  // Raw scanlines: filter byte 0 + row bytes.
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 4);
    raw[rowStart] = 0;
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, rowStart + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- Matching SVG source from the same geometry ---

function svgSource(size) {
  const pts = SHIELD.map(([x, y]) => `${(x * size).toFixed(2)},${(y * size).toFixed(2)}`).join(' ');
  const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${(size * CORNER_RADIUS).toFixed(2)}" fill="${rgb(NAVY)}"/>
  <polygon points="${pts}" fill="${rgb(SHIELD_FILL)}"/>
</svg>
`;
}

for (const size of SIZES) {
  writeFileSync(join(OUT_DIR, `icon-${size}.png`), encodePng(size, render(size)));
  writeFileSync(join(OUT_DIR, `icon-${size}.svg`), svgSource(size));
  console.log(`Created ${join(OUT_DIR, `icon-${size}`)}.png + .svg`);
}
