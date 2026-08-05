/**
 * @file pdf-merge.js
 * @description Merges several rendered PDFs into one document by copying their
 * pages. Both the workspace export and the public share viewer deliver a single
 * PDF, and both merge it here so the two stay in step.
 *
 * A classic script, like the other renderers, so the app keeps working over
 * `file://`: it publishes its API on `globalThis.docuAlignPdfMerge`.
 */
(() => {
  /**
   * Merge rendered PDFs into one document, in the order given.
   *
   * Pages are copied, never re-laid-out: `copyPages` carries each source page's
   * own content stream, resources and size across unchanged, so a merged
   * document keeps every layout its sources had. Mixed page sizes are fine --
   * the Summary is landscape and the test reports are portrait.
   * @param {Array<Uint8Array|ArrayBuffer>} documents - Rendered PDFs, in order.
   * @param {{pdfLib?: object}} [options] - Runtime overrides for tests.
   * @returns {Promise<Uint8Array>} The merged PDF's bytes.
   */
  async function mergePdfs(documents, { pdfLib = globalThis.PDFLib } = {}) {
    if (!Array.isArray(documents) || documents.length === 0) {
      throw new TypeError("Merging needs at least one document.");
    }
    if (!pdfLib) throw new Error("The PDF library is unavailable.");

    const merged = await pdfLib.PDFDocument.create();
    for (const document of documents) {
      const source = await pdfLib.PDFDocument.load(document);
      const pages = await merged.copyPages(source, source.getPageIndices());
      pages.forEach((page) => merged.addPage(page));
    }
    return merged.save();
  }

  globalThis.docuAlignPdfMerge = Object.freeze({ mergePdfs });
})();
