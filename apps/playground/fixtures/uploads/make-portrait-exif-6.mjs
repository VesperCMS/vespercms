// Generates the EXIF Orientation 6 fixture: a portrait picture whose pixels
// are stored rotated 90° counter-clockwise, plus an Orientation=6 tag that
// tells viewers to rotate it back, plus GPS tags for the stripping test.
// Usage (from the repo root): node apps/playground/fixtures/uploads/make-portrait-exif-6.mjs
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = new URL('.', import.meta.url);
const repo = fileURLToPath(new URL('../../../../', here));
const out = fileURLToPath(new URL('portrait-exif-6.jpg', here));
const sharp = createRequire(join(repo, 'package.json'))('sharp');

const w = 1200;
const h = 1600;
// Visually: a portrait card with an arrow pointing up and the word TOP at the top.
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <rect width="${w}" height="${h}" fill="#e8ecf4"/>
  <rect x="60" y="60" width="${w - 120}" height="${h - 120}" fill="#28335f"/>
  <path d="M ${w / 2} 260 L ${w / 2 + 220} 640 L ${w / 2 + 90} 640 L ${w / 2 + 90} 1200 L ${w / 2 - 90} 1200 L ${w / 2 - 90} 640 L ${w / 2 - 220} 640 Z" fill="#f3c27a"/>
  <text x="${w / 2}" y="200" font-family="sans-serif" font-size="110" font-weight="700" fill="#fff1c9" text-anchor="middle">TOP</text>
</svg>`;

// Store the pixels rotated 90° counter-clockwise (rotate(-90)), so a viewer
// that honours Orientation 6 (rotate 90° clockwise) shows it upright.
const sideways = await sharp(Buffer.from(svg)).rotate(-90).png().toBuffer();

await sharp(sideways)
  .jpeg({ quality: 80 })
  .withExif({
    IFD0: { Make: 'Vesper', Model: 'Fixture generator' },
    IFD3: {
      GPSLatitudeRef: 'N',
      GPSLatitude: '36/1 41/1 43/1',
      GPSLongitudeRef: 'W',
      GPSLongitude: '81/1 58/1 38/1',
    },
  })
  .withMetadata({ orientation: 6 })
  .toFile(out);

const meta = await sharp(out).metadata();
console.log(JSON.stringify({ width: meta.width, height: meta.height, orientation: meta.orientation, size: meta.size }));
