import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { readPdfFacts } from './pdf.ts';

/*
 * The PDF checks with the real PDF.js, in Node: the playground's untagged
 * brochure, and PDFs made here with and without tags, title and language.
 */

beforeAll(() => {
  // In the studio the worker is a Vite asset URL; Node loads it from its file.
  const require = createRequire(import.meta.url);
  GlobalWorkerOptions.workerSrc = pathToFileURL(
    require.resolve('pdfjs-dist/legacy/build/pdf.worker.min.mjs'),
  ).href;
});

/** A one-page PDF, tagged or not, with an optional title and language. */
function makePdf(options: { tagged?: boolean; title?: string; lang?: string }): Uint8Array {
  const content = options.tagged
    ? '/P <</MCID 0>> BDC BT /F1 18 Tf 72 720 Td (Course brochure) Tj ET EMC'
    : 'BT /F1 18 Tf 72 720 Td (Course brochure) Tj ET';
  const catalog = [
    '/Type /Catalog /Pages 2 0 R',
    options.tagged ? '/MarkInfo << /Marked true >> /StructTreeRoot 6 0 R' : '',
    options.lang ? `/Lang (${options.lang})` : '',
  ].join(' ');
  const objects = [
    `<< ${catalog} >>`,
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >>${options.tagged ? ' /StructParents 0' : ''} >>`,
    `<< /Length ${String(content.length)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /StructTreeRoot /K [7 0 R] /ParentTree 8 0 R >>',
    '<< /Type /StructElem /S /P /P 6 0 R /Pg 3 0 R /K 0 >>',
    '<< /Nums [0 [7 0 R]] >>',
    options.title ? `<< /Title (${options.title}) >>` : '<< /Producer (Vesper test) >>',
  ];
  let out = '%PDF-1.7\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(out.length);
    out += `${String(index + 1)} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R /Info ${String(objects.length)} 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

describe('readPdfFacts', () => {
  it('finds the playground’s brochure untagged, with no title or language', async () => {
    const bytes = readFileSync(
      new URL('../../../../apps/playground/public/files/untagged-brochure.pdf', import.meta.url),
    );
    expect(await readPdfFacts(new Uint8Array(bytes))).toEqual({
      tagged: false,
      title: null,
      language: null,
    });
  });

  it('reads tags, the title and the language when a PDF has them', async () => {
    expect(
      await readPdfFacts(makePdf({ tagged: true, title: 'Course brochure', lang: 'en-US' })),
    ).toEqual({ tagged: true, title: 'Course brochure', language: 'en-US' });
  });

  it('needs both the tagged mark and a structure tree', async () => {
    expect((await readPdfFacts(makePdf({ lang: 'en' }))).tagged).toBe(false);
  });
});
