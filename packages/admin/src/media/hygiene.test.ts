// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  detectType,
  imageFacts,
  jpegFacts,
  stripJpeg,
  stripPng,
  stripWebp,
  webpFacts,
} from './formats.ts';
import { prepareUpload, sanitizeSvg } from './hygiene.ts';

// Tests run from the repository root.
const read = (name: string) =>
  new Uint8Array(readFileSync(join(process.cwd(), 'apps/playground/fixtures/uploads', name)));

describe('detectType', () => {
  it('goes by content, not by name', () => {
    expect(detectType(read('portrait-exif-6.jpg'))).toBe('jpeg');
    expect(detectType(read('iphone-gps.heic'))).toBe('heic');
    expect(detectType(read('script.svg'))).toBe('svg');
    expect(detectType(new TextEncoder().encode('%PDF-1.7\n'))).toBe('pdf');
    expect(detectType(new TextEncoder().encode('hello'))).toBe('other');
  });
});

describe('JPEG', () => {
  it('reads size, orientation and location without decoding', () => {
    expect(jpegFacts(read('portrait-exif-6.jpg'))).toEqual({
      width: 1600,
      height: 1200,
      orientation: 6,
      hasLocation: true,
      hasMetadata: true,
    });
  });

  it('strips metadata losslessly and keeps the image data byte for byte', () => {
    const original = read('portrait-exif-6.jpg');
    const stripped = stripJpeg(original);
    expect(jpegFacts(stripped)).toEqual({
      width: 1600,
      height: 1200,
      hasLocation: false,
      hasMetadata: false,
    });
    expect(stripped.length).toBeLessThan(original.length);
    // Everything from the start of scan onward is unchanged.
    const sos = (b: Uint8Array) => b.findIndex((v, i) => v === 0xff && b[i + 1] === 0xda);
    expect(stripped.subarray(sos(stripped))).toEqual(original.subarray(sos(original)));
    expect([...stripped.subarray(-2)]).toEqual([0xff, 0xd9]);
  });
});

/** Character codes of an ASCII string. */
function codes(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) out.push(text.charCodeAt(i));
  return out;
}

/** A minimal PNG: signature, IHDR, a tEXt and an eXIf chunk, IEND. CRCs are not checked here. */
function pngWith(chunks: [string, number[]][]): Uint8Array {
  const parts: number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (const [type, data] of chunks) {
    parts.push(
      0,
      0,
      (data.length >> 8) & 0xff,
      data.length & 0xff,
      ...codes(type),
      ...data,
      0,
      0,
      0,
      0,
    );
  }
  return new Uint8Array(parts);
}

describe('PNG and WebP', () => {
  it('drop text, time and EXIF chunks from PNG', () => {
    const ihdr: [string, number[]] = ['IHDR', [0, 0, 1, 0, 0, 0, 0, 200, 8, 6, 0, 0, 0]];
    const png = pngWith([
      ihdr,
      ['tEXt', [65, 0, 66]],
      ['eXIf', [77, 77, 0, 42, 0, 0, 0, 8, 0, 0]],
      ['IEND', []],
    ]);
    expect(imageFacts('png', png)).toMatchObject({ width: 256, height: 200, hasMetadata: true });
    const stripped = stripPng(png);
    expect(imageFacts('png', stripped)).toMatchObject({ hasMetadata: false });
    expect(stripped).toEqual(pngWith([ihdr, ['IEND', []]]));
  });

  it('drop EXIF and XMP chunks from WebP and fix the header', () => {
    const chunk = (type: string, data: number[]) => {
      const size = data.length;
      return [
        ...codes(type),
        size & 0xff,
        (size >> 8) & 0xff,
        0,
        0,
        ...data,
        ...(size % 2 ? [0] : []),
      ];
    };
    // VP8X with the EXIF and XMP flags set, a 300×200 canvas.
    const vp8x = chunk('VP8X', [0x0c, 0, 0, 0, 43, 1, 0, 199, 0, 0]);
    const body = [
      ...codes('WEBP'),
      ...vp8x,
      ...chunk('EXIF', [1, 2, 3]),
      ...chunk('XMP ', [4, 5]),
      ...chunk('VP8L', [0x2f, 0, 0, 0, 0]),
    ];
    const riff = new Uint8Array([...codes('RIFF'), 0, 0, 0, 0, ...body]);
    new DataView(riff.buffer).setUint32(4, riff.length - 8, true);
    expect(webpFacts(riff)).toMatchObject({ width: 300, height: 200, hasMetadata: true });
    const stripped = stripWebp(riff);
    expect(webpFacts(stripped)).toMatchObject({ width: 300, height: 200, hasMetadata: false });
    expect(new DataView(stripped.buffer).getUint32(4, true)).toBe(stripped.length - 8);
    expect(stripped[20]).toBe(0); // the EXIF and XMP flags are cleared
  });
});

describe('SVG', () => {
  it('removes scripts, handlers, javascript: links and foreign HTML, and keeps the drawing', () => {
    const { svg, removed } = sanitizeSvg(new TextDecoder().decode(read('script.svg')));
    expect(removed).toBe(true);
    expect(svg).not.toMatch(/<script|onload|onclick|onmouseover|javascript:|foreignObject/i);
    expect(svg).toMatch(/<svg/);
    expect(svg).toMatch(/<(circle|rect|path)/);
  });

  it('leaves a clean SVG as drawn', () => {
    const { removed } = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#28335f"/></svg>',
    );
    expect(removed).toBe(false);
  });
});

describe('prepareUpload', () => {
  it('refuses a non-image in an image field', async () => {
    const result = await prepareUpload(new File(['%PDF-1.7\n'], 'brochure.pdf'), {
      accept: 'image',
    });
    expect(result).toMatchObject({ ok: false });
  });

  it('explains when HEIC can’t be converted here', async () => {
    const result = await prepareUpload(new File([read('iphone-gps.heic')], 'IMG_0001.HEIC'));
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/HEIC/) as unknown });
  });

  it('sanitizes SVG uploads and says so', async () => {
    const result = await prepareUpload(new File([read('script.svg')], 'logo.svg'), {
      accept: 'image',
    });
    expect(result.ok && result.upload.notes).toEqual([
      'Removed scripts and unsafe links from the SVG',
    ]);
  });

  it('keeps PDFs and other files as they are', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.7\nhello');
    const result = await prepareUpload(new File([bytes], 'brochure.pdf'));
    expect(result.ok && [...result.upload.bytes]).toEqual([...bytes]);
  });
});
