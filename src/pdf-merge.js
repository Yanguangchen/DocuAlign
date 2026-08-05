/**
 * @file pdf-merge.js
 * @description Merges several rendered PDFs into one document by copying their
 * pages.
 *
 * This exists for **printing only**. Deliverables stay separate files: the
 * export archives one PDF per document and the share page saves them one by
 * one. A print job, though, is one document by definition -- printing six
 * reports separately means six print dialogs -- so "print all" merges into a
 * throwaway document that is sent to the printer and never saved.
 *
 * A classic script, like the other renderers, so the app keeps working over
 * `file://`: it publishes its API on `globalThis.docuAlignPdfMerge`.
 */
(() => {
  /**
   * Merge rendered PDFs into one document, in the order given.
   *
   * Pages are copied, never re-laid-out: `copyPages` carries each source page's
   * own content stream, resources and size across unchanged, so what reaches
   * the printer is each document's approved layout. Mixed page sizes are fine
   * -- the Summary is landscape and the test reports are portrait, and the
   * print dialog honours each page's own size.
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
