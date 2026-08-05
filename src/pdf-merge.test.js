/**
 * @file pdf-merge.test.js
 * @description Behavioral coverage for the classic-script PDF merger that both
 * the workspace export and the public share viewer deliver their single
 * document through.
 */
import * as PDFLib from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A PDF whose pages carry distinguishable widths, so a merge's page order and
 * page-level fidelity can both be read back off the finished document.
 * @param {number[]} widths - One width per page.
 * @returns {Promise<Uint8Array>} The rendered PDF.
 */
async function pdfWithPageWidths(widths) {
  const pdf = await PDFLib.PDFDocument.create();
  widths.forEach((width) => pdf.addPage([width, 100]));
  return pdf.save();
}

async function pageWidths(bytes) {
  const merged = await PDFLib.PDFDocument.load(bytes);
  return merged.getPages().map((page) => Math.round(page.getWidth()));
}

describe("pdf merge", () => {
  let docuAlignPdfMerge;

  beforeEach(async () => {
    vi.resetModules();
    delete globalThis.docuAlignPdfMerge;
    globalThis.PDFLib = PDFLib;
    await import("./pdf-merge.js");
    docuAlignPdfMerge = globalThis.docuAlignPdfMerge;
  });

  afterEach(() => {
    delete globalThis.docuAlignPdfMerge;
    delete globalThis.PDFLib;
  });

  it("refuses to merge nothing", async () => {
    await expect(docuAlignPdfMerge.mergePdfs([])).rejects.toThrow(/at least one document/);
    await expect(docuAlignPdfMerge.mergePdfs(undefined)).rejects.toThrow(/at least one document/);
  });

  it("reports a missing PDF library instead of failing obscurely", async () => {
    delete globalThis.PDFLib;
    const document = await pdfWithPageWidths([200]);

    await expect(docuAlignPdfMerge.mergePdfs([document]))
      .rejects.toThrow("The PDF library is unavailable.");
    // An explicitly supplied library is used even when the global is gone.
    await expect(docuAlignPdfMerge.mergePdfs([document], { pdfLib: PDFLib })).resolves.toBeTruthy();
  });

  it("concatenates every page, in the order the documents were given", async () => {
    const merged = await docuAlignPdfMerge.mergePdfs([
      await pdfWithPageWidths([201, 202]),
      await pdfWithPageWidths([301]),
      await pdfWithPageWidths([401, 402, 403]),
    ]);

    expect(await pageWidths(merged)).toEqual([201, 202, 301, 401, 402, 403]);
  });

  it("keeps each source page's own size rather than normalising them", async () => {
    // The Summary is landscape and the test reports are portrait, so a merge
    // that imposed one page size would silently reflow half the export.
    const landscape = await PDFLib.PDFDocument.create();
    landscape.addPage([842, 595]);
    const portrait = await PDFLib.PDFDocument.create();
    portrait.addPage([595, 842]);

    const merged = await PDFLib.PDFDocument.load(
      await docuAlignPdfMerge.mergePdfs([await landscape.save(), await portrait.save()]),
    );

    expect(merged.getPages().map((page) => [
      Math.round(page.getWidth()),
      Math.round(page.getHeight()),
    ])).toEqual([[842, 595], [595, 842]]);
  });

  it("merges a single document into an equivalent one-document PDF", async () => {
    const merged = await docuAlignPdfMerge.mergePdfs([await pdfWithPageWidths([500])]);

    expect(await pageWidths(merged)).toEqual([500]);
  });
});
