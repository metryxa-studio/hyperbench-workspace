import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { TextContent } from "pdfjs-dist/types/src/display/api.js";

export const MAX_DOCUMENT_BYTES = 32 * 1024 * 1024;
const MAX_EXTRACTED_PAGES = 100;
const MAX_PAGE_CHARACTERS = 50_000;
const MAX_TEXT_CHARACTERS = 1_000_000;
const MAX_RENDER_DIMENSION = 4096;
const MAX_RENDER_PIXELS = 12_000_000;
const MAX_PNG_BYTES = 16 * 1024 * 1024;

export interface ProcessedDocument {
  mime: string;
  pageCount: number;
  pages: { page: number; text: string }[];
  coverage: string;
}

export interface DocumentCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RenderedDocumentPage {
  data: string;
  mimeType: "image/png";
  page: number;
  width: number;
  height: number;
}

function validateBytes(bytes: Buffer): void {
  if (!Buffer.isBuffer(bytes))
    throw new Error("Document contents must be a Buffer.");
  if (bytes.length > MAX_DOCUMENT_BYTES)
    throw new Error("Documents must be at most 32 MiB.");
}

function isPdf(bytes: Buffer): boolean {
  // PDF readers permit a short preamble before the file header.
  return /%PDF-\d\.\d/.test(bytes.subarray(0, 1024).toString("latin1"));
}

function boundedText(text: string, limit: number): string {
  let end = Math.min(text.length, limit);
  // Do not split an emoji or another supplementary Unicode character.
  if (end < text.length && end > 0 && /[\uD800-\uDBFF]/.test(text[end - 1]))
    end -= 1;
  return text.slice(0, end);
}

async function withPdf<T>(
  bytes: Buffer,
  operation: (pdf: PDFDocumentProxy) => Promise<T>,
): Promise<T> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const packageRoot = dirname(
    createRequire(import.meta.url).resolve("pdfjs-dist/package.json"),
  );
  // PDF.js requires a forward slash suffix, even for a Windows filesystem path.
  const localAssets = (directory: string): string =>
    join(packageRoot, directory) + "/";
  const task = getDocument({
    // PDF.js may transfer its input. Keep the caller's original Buffer intact.
    data: Uint8Array.from(bytes),
    cMapUrl: localAssets("cmaps"),
    cMapPacked: true,
    standardFontDataUrl: localAssets("standard_fonts"),
    wasmUrl: localAssets("wasm"),
    useWorkerFetch: false,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    enableXfa: false,
    stopAtErrors: true,
    verbosity: 0,
  });
  try {
    const pdf = await task.promise;
    if (!Number.isSafeInteger(pdf.numPages) || pdf.numPages < 1) {
      throw new Error("The PDF does not contain a valid page count.");
    }
    return await operation(pdf);
  } finally {
    await task.destroy();
  }
}

async function extractPageText(
  page: PDFPageProxy,
  limit: number,
): Promise<{ text: string; truncated: boolean }> {
  const reader = (
    page.streamTextContent() as ReadableStream<TextContent>
  ).getReader();
  const chunks: string[] = [];
  let length = 0;
  let finished = false;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        finished = true;
        return { text: chunks.join("").trim(), truncated: false };
      }
      for (const item of next.value.items) {
        if (!("str" in item)) continue;
        const part = item.str + (item.hasEOL ? "\n" : " ");
        if (part.length > limit - length) {
          chunks.push(boundedText(part, limit - length));
          return { text: chunks.join("").trim(), truncated: true };
        }
        chunks.push(part);
        length += part.length;
      }
    }
  } finally {
    if (!finished) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Extract bounded embedded text. Scanned PDF pages require a separate OCR tool. */
export async function processDocument(
  bytes: Buffer,
  name: string,
): Promise<ProcessedDocument> {
  validateBytes(bytes);
  if (!isPdf(bytes)) {
    if (name.toLowerCase().endsWith(".pdf"))
      throw new Error("The file does not contain a valid PDF header.");
    let source: string;
    try {
      source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Error(
        "Only PDF and UTF-8 text documents are supported; this file contains binary or invalid UTF-8 data.",
      );
    }
    if (/[\u0000-\u0008\u000B\u000E-\u001F\u007F-\u009F]/u.test(source)) {
      throw new Error(
        "Only PDF and UTF-8 text documents are supported; this file contains binary control characters.",
      );
    }
    const text = boundedText(source, MAX_TEXT_CHARACTERS);
    return {
      mime: "text/plain",
      pageCount: 1,
      pages: [{ page: 1, text }],
      coverage:
        text.length < source.length
          ? `Partial text: retained the first ${text.length} of ${source.length} characters (limit ${MAX_TEXT_CHARACTERS}); represented as one page.`
          : `Complete UTF-8 text: ${text.length} characters, represented as one page.`,
    };
  }

  return withPdf(bytes, async (pdf) => {
    const pages: ProcessedDocument["pages"] = [];
    const truncatedPages: number[] = [];
    const failedPages: number[] = [];
    let characters = 0;
    for (
      let number = 1;
      number <= Math.min(pdf.numPages, MAX_EXTRACTED_PAGES);
      number += 1
    ) {
      if (characters >= MAX_TEXT_CHARACTERS) break;
      let page: PDFPageProxy | undefined;
      try {
        page = await pdf.getPage(number);
        const extracted = await extractPageText(
          page,
          Math.min(MAX_PAGE_CHARACTERS, MAX_TEXT_CHARACTERS - characters),
        );
        pages.push({ page: number, text: extracted.text });
        characters += extracted.text.length;
        if (extracted.truncated) truncatedPages.push(number);
      } catch {
        // Preserve access to the original and renderable pages while declaring gaps.
        pages.push({ page: number, text: "" });
        failedPages.push(number);
      } finally {
        page?.cleanup();
      }
    }
    const partial =
      pages.length < pdf.numPages ||
      truncatedPages.length > 0 ||
      failedPages.length > 0;
    const coverage = [
      `${partial ? "Partial" : "Complete"} embedded-text pass: visited ${pages.length} of ${pdf.numPages} PDF pages; retained ${characters} characters.`,
      `Limits: first ${MAX_EXTRACTED_PAGES} pages, ${MAX_PAGE_CHARACTERS} characters per page, ${MAX_TEXT_CHARACTERS} characters total.`,
      ...(pages.length < pdf.numPages
        ? [`Pages ${pages.length + 1}–${pdf.numPages} were not extracted.`]
        : []),
      ...(truncatedPages.length
        ? [`Text truncated on pages ${truncatedPages.join(", ")}.`]
        : []),
      ...(failedPages.length
        ? [
            `Text extraction failed on pages ${failedPages.join(", ")}; their empty text is not evidence of blank pages.`,
          ]
        : []),
      ...(characters === 0 ? ["No embedded text was recovered."] : []),
      "No OCR was performed; scanned text, diagrams, and images require page-image inspection.",
    ].join(" ");
    return {
      mime: "application/pdf",
      pageCount: pdf.numPages,
      pages,
      coverage,
    };
  });
}

async function readDocumentBytes(filePath: string): Promise<Buffer> {
  const before = await lstat(filePath);
  if (!before.isFile() || before.isSymbolicLink())
    throw new Error(
      "Document path must refer to a regular file, not a symlink.",
    );
  const file = await open(
    filePath,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = await file.stat();
    if (!stat.isFile())
      throw new Error("Document path must refer to a regular file.");
    const after = await lstat(filePath);
    if (
      after.isSymbolicLink() ||
      stat.dev !== before.dev ||
      stat.ino !== before.ino ||
      stat.dev !== after.dev ||
      stat.ino !== after.ino
    )
      throw new Error(
        "Document changed while it was being opened; retry the operation.",
      );
    if (stat.size > MAX_DOCUMENT_BYTES)
      throw new Error("Documents must be at most 32 MiB.");
    // Read through the opened descriptor, bounded even if another process grows the file.
    const buffer = Buffer.alloc(
      Math.min(stat.size + 1, MAX_DOCUMENT_BYTES + 1),
    );
    let length = 0;
    while (length < buffer.length) {
      const result = await file.read(
        buffer,
        length,
        buffer.length - length,
        length,
      );
      if (result.bytesRead === 0) break;
      length += result.bytesRead;
    }
    if (length > stat.size)
      throw new Error(
        "Document changed while it was being read; retry the operation.",
      );
    const bytes = buffer.subarray(0, length);
    validateBytes(bytes);
    return bytes;
  } finally {
    await file.close();
  }
}

function validateCrop(crop: DocumentCrop | undefined): DocumentCrop {
  if (crop === undefined) return { x: 0, y: 0, width: 1, height: 1 };
  if (
    !crop ||
    typeof crop !== "object" ||
    ![crop.x, crop.y, crop.width, crop.height].every(
      (value) => typeof value === "number" && Number.isFinite(value),
    ) ||
    crop.x < 0 ||
    crop.y < 0 ||
    crop.width <= 0 ||
    crop.height <= 0 ||
    crop.width > 1 ||
    crop.height > 1 ||
    crop.x + crop.width > 1 ||
    crop.y + crop.height > 1
  ) {
    throw new Error(
      "Crop must be a positive rectangle inside the page, using normalized coordinates from 0 to 1.",
    );
  }
  return { x: crop.x, y: crop.y, width: crop.width, height: crop.height };
}

/** Render a PDF page, with crop coordinates relative to the displayed, rotated page. */
export async function renderDocumentPage(
  filePath: string,
  page: number,
  scale = 1.5,
  crop?: DocumentCrop,
): Promise<RenderedDocumentPage> {
  if (!Number.isSafeInteger(page) || page < 1)
    throw new Error("Page must be a positive integer.");
  if (!Number.isFinite(scale) || scale < 0.25 || scale > 4)
    throw new Error("Scale must be between 0.25 and 4.");
  const rectangle = validateCrop(crop);
  const bytes = await readDocumentBytes(filePath);
  if (!isPdf(bytes))
    throw new Error("Page images are available for PDF documents only.");

  return withPdf(bytes, async (pdf) => {
    if (page > pdf.numPages)
      throw new Error(
        `Page ${page} is outside the document's ${pdf.numPages} pages.`,
      );
    const pdfPage = await pdf.getPage(page);
    try {
      const viewport = pdfPage.getViewport({ scale });
      const fullWidth = Math.ceil(viewport.width);
      const fullHeight = Math.ceil(viewport.height);
      if (
        ![fullWidth, fullHeight].every(
          (value) => Number.isSafeInteger(value) && value > 0,
        ) ||
        fullWidth > MAX_RENDER_DIMENSION ||
        fullHeight > MAX_RENDER_DIMENSION ||
        fullWidth * fullHeight > MAX_RENDER_PIXELS
      ) {
        throw new Error(
          "Rendered page exceeds 4096 pixels per dimension or 12 million pixels; use a smaller scale.",
        );
      }
      const left = Math.floor(viewport.width * rectangle.x);
      const top = Math.floor(viewport.height * rectangle.y);
      const width = Math.max(
        1,
        Math.ceil(viewport.width * (rectangle.x + rectangle.width)) - left,
      );
      const height = Math.max(
        1,
        Math.ceil(viewport.height * (rectangle.y + rectangle.height)) - top,
      );
      const { createCanvas } = await import("@napi-rs/canvas");
      const canvas = createCanvas(width, height);
      try {
        await pdfPage.render({
          canvas: null,
          // The native canvas implements the runtime 2D API but has no DOM element.
          canvasContext: canvas.getContext(
            "2d",
          ) as unknown as CanvasRenderingContext2D,
          viewport,
          transform: [1, 0, 0, 1, -left, -top],
          background: "#ffffff",
        }).promise;
        const png = await canvas.encode("png");
        if (png.length > MAX_PNG_BYTES)
          throw new Error(
            "Rendered PNG exceeds 16 MiB; use a smaller scale or crop.",
          );
        return {
          data: png.toString("base64"),
          mimeType: "image/png",
          page,
          width,
          height,
        };
      } finally {
        // Release the native pixel allocation promptly.
        canvas.width = 1;
        canvas.height = 1;
      }
    } finally {
      pdfPage.cleanup();
    }
  });
}
