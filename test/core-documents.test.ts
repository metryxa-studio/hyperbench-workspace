import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import { MAX_DOCUMENT_BYTES, processDocument, renderDocumentPage } from '../src/core/documents.ts';

import { pdfFixture } from './pdf-fixture.ts';

test('UTF-8 text import preserves Unicode and reports bounded coverage', async () => {
  const result = await processDocument(Buffer.from('Motor controller\n温度 32 °C 🚁'), 'notes.txt');
  assert.equal(result.mime, 'text/plain');
  assert.equal(result.pageCount, 1);
  assert.equal(result.pages[0].text, 'Motor controller\n温度 32 °C 🚁');
  assert.match(result.coverage, /Complete UTF-8 text/);

  const truncated = await processDocument(Buffer.from('a'.repeat(999_999) + '🚁more'), 'long.txt');
  assert.equal(truncated.pages[0].text.length, 999_999);
  assert.match(truncated.coverage, /Partial text/);
});

test('imports reject excessive size, binary data, invalid UTF-8, and mislabeled PDFs', async () => {
  await assert.rejects(processDocument(Buffer.alloc(MAX_DOCUMENT_BYTES + 1), 'big.txt'), /32 MiB/);
  await assert.rejects(processDocument(Buffer.from([0xff, 0xfe]), 'binary.dat'), /invalid UTF-8/);
  await assert.rejects(processDocument(Buffer.from('abc\0def'), 'binary.dat'), /binary control/);
  await assert.rejects(processDocument(Buffer.from('plain text'), 'broken.pdf'), /PDF header/);
  await assert.rejects(processDocument(Buffer.from('%PDF-1.7\nnot a real PDF'), 'broken.pdf'));
});

test('PDF import extracts text and page count without mutating its source bytes', async () => {
  const bytes = pdfFixture(2);
  const original = Buffer.from(bytes);
  const result = await processDocument(bytes, 'manual.pdf');
  assert.equal(result.mime, 'application/pdf');
  assert.equal(result.pageCount, 2);
  assert.deepEqual(result.pages.map(page => page.page), [1, 2]);
  assert.match(result.pages[0].text, /Hardware context/);
  assert.match(result.coverage, /Complete embedded-text pass/);
  assert.match(result.coverage, /No OCR/);
  assert.deepEqual(bytes, original);
});

test('PDF coverage declares pages omitted by the extraction limit', async () => {
  const result = await processDocument(pdfFixture(101), 'long-manual.pdf');
  assert.equal(result.pageCount, 101);
  assert.equal(result.pages.length, 100);
  assert.match(result.coverage, /Partial embedded-text pass/);
  assert.match(result.coverage, /101–101 were not extracted/);
});

test('PDF page rendering returns PNG bytes and respects the selected crop', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hyperbench-documents-'));
  try {
    const path = join(directory, 'manual.pdf');
    await writeFile(path, pdfFixture());
    const full = await renderDocumentPage(path, 1, 1);
    assert.equal(full.mimeType, 'image/png');
    assert.equal(full.width, 200);
    assert.equal(full.height, 100);
    const cropped = await renderDocumentPage(path, 1, 1, { x: 0, y: 0, width: 0.5, height: 1 });
    const png = Buffer.from(cropped.data, 'base64');
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(png.readUInt32BE(16), 100);
    assert.equal(png.readUInt32BE(20), 100);
    assert.equal(cropped.width, 100);
    assert.equal(cropped.height, 100);
    const { createCanvas, loadImage } = await import('@napi-rs/canvas');
    const canvas = createCanvas(100, 100);
    const context = canvas.getContext('2d');
    context.drawImage(await loadImage(png), 0, 0);
    assert.deepEqual([...context.getImageData(50, 50, 1, 1).data], [255, 0, 0, 255]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('PDF rendering rejects symlinks when the platform cannot enforce O_NOFOLLOW', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hyperbench-document-symlink-'));
  try {
    const original = join(directory, 'original.pdf');
    const link = join(directory, 'linked.pdf');
    await writeFile(original, pdfFixture());
    await symlink(original, link, 'file');
    const moduleUrl = new URL('../src/core/documents.ts', import.meta.url).href;
    const script = `
      import assert from 'node:assert/strict';
      import {constants} from 'node:fs';
      import fs from 'node:fs/promises';
      import {syncBuiltinESMExports} from 'node:module';
      import {renderDocumentPage} from ${JSON.stringify(moduleUrl)};
      const path = process.argv[1];
      const originalOpen = fs.open;
      fs.open = function(path,flags,...args) { return originalOpen.call(this,path,typeof flags === 'number' ? flags & ~(constants.O_NOFOLLOW || 0) : flags,...args); };
      syncBuiltinESMExports();
      const file = await fs.open(path,constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      await file.close();
      await assert.rejects(renderDocumentPage(path,1,1),/symlink/);
    `;
    await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script, link], { timeout: 5000 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rendering rejects invalid page, scale, crop, document type, and output size', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hyperbench-documents-'));
  try {
    const path = join(directory, 'manual.pdf');
    await writeFile(path, pdfFixture());
    await assert.rejects(renderDocumentPage(path, 0), /positive integer/);
    await assert.rejects(renderDocumentPage(path, 1.5), /positive integer/);
    await assert.rejects(renderDocumentPage(path, 2), /outside/);
    for (const scale of [0, NaN, Infinity, 4.1]) {
      await assert.rejects(renderDocumentPage(path, 1, scale), /Scale/);
    }
    for (const crop of [
      { x: -1, y: 0, width: 1, height: 1 },
      { x: 0.5, y: 0, width: 1, height: 1 },
      { x: 0, y: 0, width: 0, height: 1 },
      { x: 0, y: NaN, width: 1, height: 1 },
    ]) {
      await assert.rejects(renderDocumentPage(path, 1, 1, crop), /Crop/);
    }
    await writeFile(path, pdfFixture(1, 5000, 5000));
    await assert.rejects(renderDocumentPage(path, 1, 1), /4096 pixels/);
    await writeFile(path, 'plain text');
    await assert.rejects(renderDocumentPage(path, 1), /PDF documents only/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
