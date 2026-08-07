import * as PDFLib from "pdf-lib";
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * A one-page PDF whose page width identifies which document produced it, so
 * an archive's entries can be told apart once read back.
 * @param {number} width - The marker width, unique per document.
 * @returns {Promise<Uint8Array>} A valid single-page PDF.
 */
async function markerPdf(width) {
  const pdf = await PDFLib.PDFDocument.create();
  pdf.addPage([width, 100]);
  return pdf.save();
}

vi.mock("./lib/firebase.js", () => ({
  db: {},
}));

const mockFetchSharedReport = vi.fn();
const mockFetchSharedBundle = vi.fn();
vi.mock("./lib/share.js", async () => {
  const actual = await vi.importActual("./lib/share.js");
  return {
    ...actual,
    fetchSharedReport: (...args) => mockFetchSharedReport(...args),
    fetchSharedBundle: (...args) => mockFetchSharedBundle(...args),
  };
});

const VALID_TOKEN = "aB3dEfGh1JkLmNoPqRsTuVwXyZ012345";

function share(overrides = {}) {
  return {
    token: VALID_TOKEN,
    reportId: "doc-1",
    reportName: "rak-report",
    sourceFileName: "rak-report.xlsx",
    status: "complete",
    pdfUrl: "SampleDocuments/SampleOutput.pdf",
    publishedAt: new Date("2026-06-15T10:00:00"),
    ...overrides,
  };
}

describe("view-report module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    delete globalThis.docuAlignSummaryPdf;
    // The viewer fetches the PDF to derive file size and page count; answer
    // with a fake 3-page document so tests stay deterministic and offline.
    const fakePdf = new TextEncoder().encode(
      `%PDF-1.4 /Type /Pages /Type /Page /Type /Page /Type /Page ${"x".repeat(1024 * 1024)}`,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(fakePdf.buffer),
      }),
    );
    document.body.innerHTML = `
      <p id="share-status"></p>
      <article id="share-report" hidden>
        <h2 id="share-report-name">RAK Concrete Test Report</h2>
        <p id="share-report-subtitle" hidden></p>
        <p id="share-report-status"></p>
        <dl>
          <dd id="share-shared-by">By RAK Materials Consultants</dd>
          <dd id="share-published"></dd>
          <dd id="share-reference"></dd>
          <div id="share-size-row" hidden><dd id="share-size"></dd></div>
          <div id="share-pages-row" hidden><dd id="share-pages"></dd></div>
        </dl>
        <a id="share-pdf-link" href="#"></a>
        <a id="share-download-link" href="#"></a>
        <details id="share-source-details" hidden>
          <p id="share-source"></p>
        </details>
        <iframe id="share-preview-frame" src="about:blank"></iframe>
        <a id="share-preview-overlay" href="#"></a>
        <p id="share-preview-caption">First page preview</p>
      </article>
      <article id="share-bundle" hidden>
        <strong id="share-bundle-name"></strong>
        <span id="share-bundle-count"></span>
        <span id="share-bundle-published"></span>
        <button id="share-bundle-download" type="button"></button>
        <button id="share-bundle-print" type="button"></button>
        <p id="share-bundle-download-note" hidden></p>
        <ul id="share-bundle-list"></ul>
      </article>
    `;
  });

  function bundle(overrides = {}) {
    return {
      token: VALID_TOKEN,
      bundleName: "Customer pack",
      reports: [
        {
          reportId: "doc-1",
          reportName: "report-a",
          sourceFileName: "a.xlsx",
          status: "complete",
          pdfUrl: "SampleDocuments/SampleOutput.pdf",
        },
        {
          reportId: "doc-2",
          reportName: "report-b",
          sourceFileName: null,
          status: "saved",
          pdfUrl: "javascript:alert(1)",
        },
      ],
      publishedAt: new Date("2026-06-15T10:00:00"),
      ...overrides,
    };
  }

  describe("getShareTokenFromUrl", () => {
    it("extracts the share token from a query string", async () => {
      const { getShareTokenFromUrl } = await import("./view-report.js");
      expect(getShareTokenFromUrl(`?share=${VALID_TOKEN}`)).toBe(VALID_TOKEN);
    });

    it("returns null when the parameter is absent or malformed", async () => {
      const { getShareTokenFromUrl } = await import("./view-report.js");
      expect(getShareTokenFromUrl("")).toBeNull();
      expect(getShareTokenFromUrl("?share=")).toBeNull();
      expect(getShareTokenFromUrl("?share=not-a-token")).toBeNull();
      expect(getShareTokenFromUrl("?other=value")).toBeNull();
    });
  });

  describe("safePdfUrl", () => {
    it("passes through relative paths and https URLs", async () => {
      const { safePdfUrl } = await import("./view-report.js");
      expect(safePdfUrl("SampleDocuments/SampleOutput.pdf")).toBe(
        "SampleDocuments/SampleOutput.pdf",
      );
      expect(safePdfUrl("https://example.com/report.pdf")).toBe(
        "https://example.com/report.pdf",
      );
    });

    it("falls back to the bundled PDF for unsafe or missing URLs", async () => {
      const { safePdfUrl } = await import("./view-report.js");
      const fallback = "SampleDocuments/SampleOutput.pdf";
      expect(safePdfUrl("javascript:alert(1)")).toBe(fallback);
      expect(safePdfUrl("//evil.example.com/x.pdf")).toBe(fallback);
      expect(safePdfUrl("data:text/html,<script>1</script>")).toBe(fallback);
      expect(safePdfUrl("http://insecure.example.com/x.pdf")).toBe(fallback);
      expect(safePdfUrl("")).toBe(fallback);
      expect(safePdfUrl(null)).toBe(fallback);
    });
  });

  describe("resolveDocumentUrl", () => {
    const sections = [{ heading: "DS1  (2)", columns: ["A", "B"], rows: [["Sieve", "19.7"]] }];

    beforeEach(async () => {
      await import("./pdf-writer.js");
      vi.stubGlobal(
        "URL",
        Object.assign(globalThis.URL, { createObjectURL: vi.fn(() => "blob:rebuilt") }),
      );
    });

    it("rebuilds a generated document into a real PDF blob", async () => {
      const { resolveDocumentUrl } = await import("./view-report.js");

      const url = await resolveDocumentUrl(
        share({ reportName: "DS1 Datasheet", documentData: JSON.stringify(sections) }),
      );

      expect(url).toBe("blob:rebuilt");
      const [blob] = URL.createObjectURL.mock.calls[0];
      expect(blob.type).toBe("application/pdf");
      // The blob really is a PDF built from the published worksheet data.
      const text = await blob.text();
      expect(text.startsWith("%PDF-")).toBe(true);
      expect(text).toContain("(Sieve)");
    });

    it("rebuilds a shared test report by overlaying its mapped values", async () => {
      const report = { groupIndex: 2, jobRef: "X-2026-522-2", cover: { sampleId: "3-A" } };
      const createRakReportPdf = vi.fn(async () =>
        new Blob([new Uint8Array([37, 80, 68, 70])], { type: "application/pdf" }));
      globalThis.docuAlignRakReportPdf = { createRakReportPdf };
      const { resolveDocumentUrl } = await import("./view-report.js");

      const url = await resolveDocumentUrl(
        share({
          reportName: "Test Report X-2026-522-2",
          documentData: JSON.stringify({ renderer: "report", report }),
        }),
      );

      expect(url).toBe("blob:rebuilt");
      // The recipient sees the uploaded workbook's report, not the reference.
      expect(createRakReportPdf).toHaveBeenCalledWith([expect.objectContaining(report)]);
      const [blob] = URL.createObjectURL.mock.calls[0];
      expect(blob.type).toBe("application/pdf");
      delete globalThis.docuAlignRakReportPdf;
    });

    it("refetches a shared report's uploaded photographs before rendering", async () => {
      const photo = new Uint8Array([1, 2, 3, 4]);
      const signature = new Uint8Array([9, 9]);
      fetch.mockReset().mockImplementation(async (url) => ({
        ok: true,
        arrayBuffer: async () => (url.includes("sig") ? signature : photo).buffer,
      }));
      const createRakReportPdf = vi.fn(async () =>
        new Blob([new Uint8Array([37, 80, 68, 70])], { type: "application/pdf" }));
      globalThis.docuAlignRakReportPdf = { createRakReportPdf };
      const { resolveDocumentUrl } = await import("./view-report.js");

      await resolveDocumentUrl(share({
        documentData: JSON.stringify({
          renderer: "report",
          report: {
            jobRef: "X-1",
            assets: {
              preparedSignature: { name: "sig-a", mimeType: "image/png", url: "https://x/sig-a" },
              authorisedSignature: null,
            },
            appendix: {
              label: "Photographs",
              photos: [{ name: "p1", mimeType: "image/jpeg", url: "https://x/p1" }],
            },
          },
        }),
      }));

      // The bytes the renderer draws come back from Storage, so a recipient
      // sees the uploaded workbook's artwork rather than the reference's.
      const [[rebuilt]] = createRakReportPdf.mock.calls[0];
      expect([...rebuilt.appendix.photos[0].bytes]).toEqual([1, 2, 3, 4]);
      expect([...rebuilt.assets.preparedSignature.bytes]).toEqual([9, 9]);
      expect(rebuilt.assets.authorisedSignature).toBeNull();
      // Untouched fields survive the restore.
      expect(rebuilt.appendix.label).toBe("Photographs");
      expect(rebuilt.jobRef).toBe("X-1");
      delete globalThis.docuAlignRakReportPdf;
    });

    it("keeps the reference artwork when an uploaded picture cannot be fetched", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      fetch.mockReset().mockResolvedValue({ ok: false, status: 404 });
      const createRakReportPdf = vi.fn(async () =>
        new Blob([new Uint8Array([37, 80, 68, 70])], { type: "application/pdf" }));
      globalThis.docuAlignRakReportPdf = { createRakReportPdf };
      const { resolveDocumentUrl } = await import("./view-report.js");

      await resolveDocumentUrl(share({
        documentData: JSON.stringify({
          renderer: "report",
          report: {
            appendix: { photos: [{ name: "p1", url: "https://x/gone" }] },
          },
        }),
      }));

      // No bytes means "nothing to draw here", which leaves the reference
      // page's own artwork rather than failing the whole document.
      const [[rebuilt]] = createRakReportPdf.mock.calls[0];
      expect(rebuilt.appendix.photos[0].bytes).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        "[DocuAlign] Could not load a shared report picture",
        expect.objectContaining({ category: "PhotoFetchFailure" }),
      );
      delete globalThis.docuAlignRakReportPdf;
    });

    it("distinguishes a share published without any uploaded photographs", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const createRakReportPdf = vi.fn(async () =>
        new Blob([new Uint8Array([37, 80, 68, 70])], { type: "application/pdf" }));
      globalThis.docuAlignRakReportPdf = { createRakReportPdf };
      const { resolveDocumentUrl } = await import("./view-report.js");

      await resolveDocumentUrl(share({
        documentData: JSON.stringify({
          renderer: "report",
          // Metadata but no URL: the upload was refused when this was saved,
          // which looks identical on the page to a download that fails now.
          report: { appendix: { photos: [{ name: "p1" }, { name: "p2" }] } },
        }),
      }));

      expect(warnSpy).toHaveBeenCalledWith(
        "[DocuAlign] This share carries no uploaded photographs",
        expect.objectContaining({ category: "SharePublishedWithoutPictures" }),
      );
      expect(fetch).not.toHaveBeenCalled();
      delete globalThis.docuAlignRakReportPdf;
    });

    it("falls back to the stored PDF when a shared report cannot be rebuilt", async () => {
      globalThis.docuAlignRakReportPdf = {
        createRakReportPdf: vi.fn(async () => {
          throw new Error("Template unavailable");
        }),
      };
      const { resolveDocumentUrl } = await import("./view-report.js");

      const url = await resolveDocumentUrl(
        share({
          pdfUrl: "SampleDocuments/SampleOutput.pdf",
          documentData: JSON.stringify({ renderer: "report", report: { jobRef: "X-1" } }),
        }),
      );

      expect(url).toBe("SampleDocuments/SampleOutput.pdf");
      delete globalThis.docuAlignRakReportPdf;
    });

    it("rebuilds a Summary share with the fixed-format renderer", async () => {
      const createDocument = vi.fn(async (cells) => {
        expect(cells).toEqual(new Map([["U10", "X-2026-522"]]));
        return new Uint8Array([37, 80, 68, 70]);
      });
      globalThis.docuAlignSummaryPdf = { createDocument };
      const { resolveDocumentUrl } = await import("./view-report.js");

      const url = await resolveDocumentUrl(
        share({
          reportName: "Summary",
          documentData: JSON.stringify({
            renderer: "summary",
            cells: [["U10", "X-2026-522"]],
          }),
        }),
      );

      expect(url).toBe("blob:rebuilt");
      expect(createDocument).toHaveBeenCalledOnce();
      const [blob] = URL.createObjectURL.mock.calls[0];
      expect(blob.type).toBe("application/pdf");
    });

    it("upgrades a legacy Summary document when it is opened from a package", async () => {
      const recoveredCells = new Map([["U10", "X-2026-522"]]);
      const cellsFromDocumentData = vi.fn(() => recoveredCells);
      const createDocument = vi.fn(async () => new Uint8Array([37, 80, 68, 70]));
      globalThis.docuAlignSummaryPdf = { cellsFromDocumentData, createDocument };
      const legacyData = [{ heading: "Summary", columns: ["A"], rows: [["Summary"]] }];
      const { resolveDocumentUrl } = await import("./view-report.js");

      const url = await resolveDocumentUrl(
        share({
          reportName: "Summary",
          documentSlug: "Summary",
          documentData: JSON.stringify(legacyData),
        }),
      );

      expect(url).toBe("blob:rebuilt");
      expect(cellsFromDocumentData).toHaveBeenCalledWith(legacyData);
      expect(createDocument).toHaveBeenCalledWith(recoveredCells);
    });

    it("falls back when fixed-format Summary rendering fails asynchronously", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      globalThis.docuAlignSummaryPdf = {
        createDocument: vi.fn().mockRejectedValue(new Error("Template unavailable")),
      };
      const { resolveDocumentUrl } = await import("./view-report.js");

      const url = await resolveDocumentUrl(
        share({
          documentData: JSON.stringify({ renderer: "summary", cells: [] }),
        }),
      );

      expect(url).toBe("SampleDocuments/SampleOutput.pdf");
      expect(warnSpy).toHaveBeenCalledWith(
        "[DocuAlign] Could not rebuild the shared document",
        expect.any(Error),
        expect.objectContaining({ category: "Rendering" }),
      );
      warnSpy.mockRestore();
    });

    it("serves the fixed-format report from its asset when no data travels", async () => {
      const { resolveDocumentUrl } = await import("./view-report.js");

      expect(resolveDocumentUrl(share())).toBe("SampleDocuments/SampleOutput.pdf");
      expect(resolveDocumentUrl(share({ documentData: "" }))).toBe(
        "SampleDocuments/SampleOutput.pdf",
      );
      expect(URL.createObjectURL).not.toHaveBeenCalled();
    });

    it("falls back to the asset when the published data is unusable", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { resolveDocumentUrl } = await import("./view-report.js");

      expect(resolveDocumentUrl(share({ documentData: "{not json" }))).toBe(
        "SampleDocuments/SampleOutput.pdf",
      );
      expect(warnSpy).toHaveBeenCalledWith(
        "[DocuAlign] Could not rebuild the shared document",
        expect.any(Error),
        expect.objectContaining({ feature: "PublicShare" }),
      );
      warnSpy.mockRestore();
    });

    it("tolerates published data that is not a list of sections", async () => {
      const { resolveDocumentUrl } = await import("./view-report.js");
      expect(await resolveDocumentUrl(share({ documentData: '{"rows":[]}' })))
        .toBe("blob:rebuilt");
    });

    it("titles a rebuilt document generically when the share has no name", async () => {
      const { resolveDocumentUrl } = await import("./view-report.js");
      await resolveDocumentUrl(share({ reportName: "", documentData: JSON.stringify(sections) }));

      const [blob] = URL.createObjectURL.mock.calls[0];
      expect(await blob.text()).toContain("(RAK Concrete Test Report)");
    });
  });

  describe("samplingOrder", () => {
    it("parses both date shapes and sorts everything else last", async () => {
      const { samplingOrder } = await import("./view-report.js");

      expect(samplingOrder("08/04/2026")).toBe(20260408);
      expect(samplingOrder("1-5-2026")).toBe(20260501);
      expect(samplingOrder("2026-04-09")).toBe(20260409);
      // Day-first, not month-first: the workbook writes 12/06 as 12 June.
      expect(samplingOrder("12/06/2026")).toBeGreaterThan(samplingOrder("06/12/2025"));
      for (const unparsed of ["", "   ", "April 8th", "08/04/26", null, undefined]) {
        expect(samplingOrder(unparsed)).toBe(Number.POSITIVE_INFINITY);
      }
    });
  });

  describe("bundleOrder", () => {
    it("puts the Summary first and orders reports oldest sampling date first", async () => {
      const { bundleOrder } = await import("./view-report.js");
      const report = (name, samplingDate) => ({
        reportName: name,
        documentData: JSON.stringify({
          renderer: "report",
          report: { cover: { samplingDate } },
        }),
      });

      const ordered = bundleOrder([
        report("june", "12/06/2026"),
        // ISO dates compare correctly against the workbook's day-first ones.
        report("iso-april", "2026-04-09"),
        report("undated", ""),
        { reportName: "Summary", documentSlug: "Summary", documentData: null },
        report("april", "08/04/2026"),
      ]);

      expect(ordered.map((entry) => entry.reportName)).toEqual([
        "Summary",
        "april",
        "iso-april",
        "june",
        "undated",
      ]);
    });

    it("keeps the package's own order for documents sharing a sampling date", async () => {
      const { bundleOrder } = await import("./view-report.js");
      const report = (name, samplingDate) => ({
        reportName: name,
        documentData: JSON.stringify({
          renderer: "report",
          report: { cover: { samplingDate } },
        }),
      });

      // One vessel sampled across a day is the common case; those reports keep
      // the order the package was built in rather than being reshuffled.
      const ordered = bundleOrder([
        report("first", "08/04/2026"),
        report("second", "08/04/2026"),
        report("third", "08/04/2026"),
      ]);

      expect(ordered.map((entry) => entry.reportName)).toEqual(["first", "second", "third"]);
    });

    it("keeps a share whose payload cannot be read, ordering it last", async () => {
      const { bundleOrder } = await import("./view-report.js");
      const ordered = bundleOrder([
        { reportName: "broken", documentData: "{not json" },
        { reportName: "summary", documentData: JSON.stringify({ renderer: "summary", cells: [] }) },
      ]);

      expect(ordered.map((entry) => entry.reportName)).toEqual(["summary", "broken"]);
    });
  });

  describe("formatShareStatus", () => {
    it("maps known statuses to recipient-facing labels", async () => {
      const { formatShareStatus } = await import("./view-report.js");
      expect(formatShareStatus("complete")).toEqual({ icon: "✓", label: "Report complete" });
      expect(formatShareStatus("saved").label).toBe("Report complete");
      expect(formatShareStatus(null).label).toBe("Report complete");
      expect(formatShareStatus("expired")).toMatchObject({
        label: "Link expired",
        hint: "Ask the report owner for a new link.",
      });
      expect(formatShareStatus("processing").label).toBe("Processing");
    });

    it("shows unknown statuses verbatim instead of hiding them", async () => {
      const { formatShareStatus } = await import("./view-report.js");
      expect(formatShareStatus("archived")).toEqual({ label: "archived" });
    });
  });

  describe("formatFileSize", () => {
    it("formats megabyte and kilobyte sizes", async () => {
      const { countPdfPages, formatFileSize } = await import("./view-report.js");
      expect(formatFileSize(1.8 * 1024 * 1024)).toBe("1.8 MB");
      expect(formatFileSize(512 * 1024)).toBe("512 KB");
      expect(formatFileSize(10)).toBe("1 KB");
      expect(countPdfPages("PDF without page objects")).toBe(0);
    });
  });

  describe("initViewer", () => {
    it("renders the explanatory hint for a status that carries one", async () => {
      mockFetchSharedReport.mockResolvedValueOnce(share({ status: "processing" }));
      const { initViewer } = await import("./view-report.js");

      await initViewer(`?share=${VALID_TOKEN}`);

      const status = document.querySelector("#share-report-status");
      expect(status.textContent).toContain("Processing");
      // Hinted statuses show guidance and omit the completion check mark.
      expect(status.querySelector(".share-status-hint").textContent).toBe(
        "The PDF is still being generated. Check back shortly.",
      );
      expect(status.querySelector(".share-status-check")).toBeNull();
    });

    it("hides the size and page details when the PDF fetch fails", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
      mockFetchSharedReport.mockResolvedValueOnce(share());
      const { initViewer } = await import("./view-report.js");

      await initViewer(`?share=${VALID_TOKEN}`);
      await new Promise((resolve) => setTimeout(resolve));

      expect(document.querySelector("#share-size-row").hidden).toBe(true);
      expect(document.querySelector("#share-pages-row").hidden).toBe(true);
    });

    it("hides both details for an empty PDF body", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        }),
      );
      mockFetchSharedReport.mockResolvedValueOnce(share());
      const { initViewer } = await import("./view-report.js");

      await initViewer(`?share=${VALID_TOKEN}`);
      await new Promise((resolve) => setTimeout(resolve));

      expect(document.querySelector("#share-size-row").hidden).toBe(true);
      expect(document.querySelector("#share-pages-row").hidden).toBe(true);
    });

    it("uses the singular page wording for a one-page PDF", async () => {
      const onePage = new TextEncoder().encode("%PDF-1.4 /Type /Page ");
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          arrayBuffer: () => Promise.resolve(onePage.buffer),
        }),
      );
      mockFetchSharedReport.mockResolvedValueOnce(share());
      const { initViewer } = await import("./view-report.js");

      await initViewer(`?share=${VALID_TOKEN}`);
      await new Promise((resolve) => setTimeout(resolve));

      expect(document.querySelector("#share-pages").textContent).toBe("1 page");
      expect(document.querySelector("#share-preview-caption").textContent).toBe("Page 1 of 1");
    });

    it("renders the shared report and links its PDF output", async () => {
      mockFetchSharedReport.mockResolvedValueOnce(share());
      const { initViewer } = await import("./view-report.js");

      await initViewer(`?share=${VALID_TOKEN}`);

      expect(mockFetchSharedReport).toHaveBeenCalledWith({}, VALID_TOKEN);
      expect(document.querySelector("#share-report").hidden).toBe(false);
      expect(document.querySelector("#share-status").hidden).toBe(true);
      expect(document.querySelector("#share-reference").textContent).toBe("rak-report");
      expect(document.querySelector("#share-report-status").textContent).toContain(
        "Report complete",
      );
      expect(document.querySelector("#share-source-details").hidden).toBe(false);
      expect(document.querySelector("#share-source").textContent).toContain("rak-report.xlsx");
      expect(document.querySelector("#share-published").textContent).not.toBe("");
      expect(document.querySelector("#share-pdf-link").getAttribute("href")).toBe(
        "SampleDocuments/SampleOutput.pdf",
      );
      expect(document.querySelector("#share-download-link").getAttribute("href")).toBe(
        "SampleDocuments/SampleOutput.pdf",
      );
      expect(document.querySelector("#share-preview-frame").getAttribute("src")).toBe(
        "SampleDocuments/SampleOutput.pdf#page=1&toolbar=0&navpanes=0&scrollbar=0",
      );
      expect(document.querySelector("#share-preview-overlay").getAttribute("href")).toBe(
        "SampleDocuments/SampleOutput.pdf",
      );

      // Without extracted title fields the card shows the generic title.
      expect(document.querySelector("#share-report-name").textContent).toBe(
        "RAK Concrete Test Report",
      );
      expect(document.querySelector("#share-report-subtitle").hidden).toBe(true);

      // File size and page count arrive from a follow-up fetch of the PDF.
      await new Promise((resolve) => setTimeout(resolve));
      expect(document.querySelector("#share-size-row").hidden).toBe(false);
      expect(document.querySelector("#share-size").textContent).toBe("1.0 MB");
      expect(document.querySelector("#share-pages-row").hidden).toBe(false);
      expect(document.querySelector("#share-pages").textContent).toBe("3 pages");
      expect(document.querySelector("#share-preview-caption").textContent).toBe("Page 1 of 3");
    });

    it("renders recipient guidance for a status with a hint", async () => {
      mockFetchSharedReport.mockResolvedValueOnce(share({ status: "expired" }));
      const { initViewer } = await import("./view-report.js");

      await initViewer(`?share=${VALID_TOKEN}`);

      expect(document.querySelector("#share-report-status").textContent).toContain("Link expired");
      expect(document.querySelector(".share-status-hint").textContent).toBe(
        "Ask the report owner for a new link.",
      );
    });

    it("only reveals PDF details that can be derived", async () => {
      mockFetchSharedReport.mockResolvedValue(share());
      fetch.mockReset().mockResolvedValueOnce({ ok: false });
      const { initViewer } = await import("./view-report.js");

      await initViewer(`?share=${VALID_TOKEN}`);
      await new Promise((resolve) => setTimeout(resolve));
      expect(document.querySelector("#share-size-row").hidden).toBe(true);
      expect(document.querySelector("#share-pages-row").hidden).toBe(true);

      fetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      });
      await initViewer(`?share=${VALID_TOKEN}`);
      await new Promise((resolve) => setTimeout(resolve));
      expect(document.querySelector("#share-size-row").hidden).toBe(true);
      expect(document.querySelector("#share-pages-row").hidden).toBe(true);

      const onePagePdf = new TextEncoder().encode("%PDF-1.4 /Type /Page");
      fetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(onePagePdf.buffer),
      });
      await initViewer(`?share=${VALID_TOKEN}`);
      await new Promise((resolve) => setTimeout(resolve));
      expect(document.querySelector("#share-size-row").hidden).toBe(false);
      expect(document.querySelector("#share-pages").textContent).toBe("1 page");
    });

    it("renders a data-driven title when the share carries extracted fields", async () => {
      mockFetchSharedReport.mockResolvedValueOnce(
        share({
          reportTitle: "Reclamation Sand Testing Report",
          clientName: "Xinsha Holding Pte Ltd",
          jobRef: "X-2026-522-2",
        }),
      );
      const { initViewer } = await import("./view-report.js");

      await initViewer(`?share=${VALID_TOKEN}`);

      expect(document.querySelector("#share-report-name").textContent).toBe(
        "Reclamation Sand Testing Report",
      );
      const subtitle = document.querySelector("#share-report-subtitle");
      expect(subtitle.hidden).toBe(false);
      expect(subtitle.textContent).toBe("Xinsha Holding Pte Ltd · Job reference X-2026-522-2");
    });

    it("renders fallbacks when optional share fields are missing", async () => {
      mockFetchSharedReport.mockResolvedValueOnce(
        share({ reportName: null, sourceFileName: null, status: null, publishedAt: null }),
      );
      const { initViewer } = await import("./view-report.js");

      await initViewer(`?share=${VALID_TOKEN}`);

      expect(document.querySelector("#share-reference").textContent).toBe("Untitled report");
      expect(document.querySelector("#share-report-status").textContent).toContain(
        "Report complete",
      );
      expect(document.querySelector("#share-source-details").hidden).toBe(true);
      expect(document.querySelector("#share-source").textContent).toBe("");
      expect(document.querySelector("#share-published").textContent).toBe("Date unavailable");
    });

    it("shows an invalid-link message without querying Firestore", async () => {
      const { initViewer } = await import("./view-report.js");

      await initViewer("?share=broken");

      expect(mockFetchSharedReport).not.toHaveBeenCalled();
      expect(document.querySelector("#share-report").hidden).toBe(true);
      expect(document.querySelector("#share-status").textContent).toContain(
        "This share link is not valid. Check the URL and try again.",
      );
    });

    it("shows a revoked message when the share no longer exists", async () => {
      mockFetchSharedReport.mockResolvedValueOnce(null);
      const { initViewer } = await import("./view-report.js");

      await initViewer(`?share=${VALID_TOKEN}`);

      expect(document.querySelector("#share-report").hidden).toBe(true);
      expect(document.querySelector("#share-status").textContent).toContain(
        "This share link is no longer available. Ask the report owner for a new link.",
      );
    });

    /**
     * Prepare a package test: a capturing createObjectURL and a `fetch` that
     * answers with a real PDF for asset-backed shares.
     * @returns {Promise<{blobs: Blob[]}>} Blobs handed to createObjectURL.
     */
    async function stubPackageRuntime() {
      const blobs = [];
      vi.stubGlobal("URL", Object.assign(globalThis.URL, {
        createObjectURL: vi.fn((blob) => {
          blobs.push(blob);
          return `blob:doc-${blobs.length}`;
        }),
        revokeObjectURL: vi.fn(),
      }));
      const assetPdf = await markerPdf(ASSET_MARKER);
      fetch.mockReset().mockResolvedValue({
        ok: true,
        arrayBuffer: async () =>
          assetPdf.buffer.slice(assetPdf.byteOffset, assetPdf.byteOffset + assetPdf.byteLength),
      });
      return { blobs };
    }

    /**
     * What the download-all button actually saved: one entry per download,
     * each its own PDF, in the order the downloads were started.
     * @param {Blob[]} blobs - Blobs captured from createObjectURL.
     * @param {Object} anchorClick - The anchor click spy.
     * @returns {Promise<Array<{name: string, marker: number}>>} Saved files.
     */
    async function savedDocuments(blobs, anchorClick) {
      // The listing renders one blob per card before any download starts, so
      // only the trailing blobs -- one per click -- are the saved files.
      const saved = blobs.slice(blobs.length - anchorClick.mock.contexts.length);
      return Promise.all(saved.map(async (blob, index) => {
        const pdf = await PDFLib.PDFDocument.load(await blob.arrayBuffer());
        return {
          name: anchorClick.mock.contexts.at(index).download,
          marker: Math.round(pdf.getPage(0).getWidth()),
        };
      }));
    }

    const ASSET_MARKER = 700;

    it("lists every packaged document separately, in the export's own order", async () => {
      await stubPackageRuntime();
      globalThis.docuAlignRakReportPdf = {
        createRakReportPdf: vi.fn(async ([report]) => new Blob(
          [await markerPdf(Number(report.marker))],
          { type: "application/pdf" },
        )),
      };
      globalThis.docuAlignSummaryPdf = { createDocument: vi.fn(async () => markerPdf(500)) };
      const reportShare = (marker, samplingDate) => ({
        reportId: `doc-${marker}`,
        reportName: `Report ${marker}`,
        sourceFileName: `${marker}.xlsx`,
        status: "complete",
        pdfUrl: null,
        documentData: JSON.stringify({
          renderer: "report",
          report: { marker, cover: { samplingDate } },
        }),
      });
      mockFetchSharedBundle.mockResolvedValueOnce(bundle({
        reports: [
          reportShare(602, "12/06/2026"),
          reportShare(601, "08/04/2026"),
          {
            reportId: "doc-summary",
            reportName: "Summary",
            status: "complete",
            pdfUrl: null,
            documentData: JSON.stringify({ renderer: "summary", cells: [["U10", "X-1"]] }),
          },
        ],
      }));
      const { initViewer } = await import("./view-report.js");

      await initViewer(`?bundle=${VALID_TOKEN}`);

      expect(mockFetchSharedBundle).toHaveBeenCalledWith({}, VALID_TOKEN);
      expect(mockFetchSharedReport).not.toHaveBeenCalled();
      expect(document.querySelector("#share-bundle").hidden).toBe(false);
      expect(document.querySelector("#share-report").hidden).toBe(true);
      expect(document.querySelector("#share-bundle-name").textContent).toBe("Customer pack");
      expect(document.querySelector("#share-bundle-count").textContent).toBe("3 documents");

      // One card per document, Summary first then reports oldest date first.
      const items = [...document.querySelectorAll("#share-bundle-list li")];
      expect(items).toHaveLength(3);
      expect(items.map((item) => item.querySelector("strong").textContent)).toEqual([
        "Summary",
        "Report 601",
        "Report 602",
      ]);
      expect(items[1].textContent).toContain("601.xlsx");
      expect(document.querySelectorAll("#share-bundle-list a")[0].getAttribute("rel"))
        .toBe("noopener");
      delete globalThis.docuAlignRakReportPdf;
    });

    it("downloads every packaged document as its own file from a single button", async () => {
      const { blobs } = await stubPackageRuntime();
      globalThis.docuAlignRakReportPdf = {
        createRakReportPdf: vi.fn(async ([report]) => new Blob(
          [await markerPdf(Number(report.marker))],
          { type: "application/pdf" },
        )),
      };
      globalThis.docuAlignSummaryPdf = { createDocument: vi.fn(async () => markerPdf(500)) };
      const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(() => {});
      mockFetchSharedBundle.mockResolvedValueOnce(bundle({
        reports: [
          {
            reportId: "doc-r",
            reportName: "Test Report X-1",
            status: "complete",
            pdfUrl: null,
            documentData: JSON.stringify({
              renderer: "report",
              report: { marker: 601, cover: { samplingDate: "08/04/2026" } },
            }),
          },
          {
            reportId: "doc-s",
            reportName: "Summary",
            status: "complete",
            pdfUrl: null,
            documentData: JSON.stringify({ renderer: "summary", cells: [] }),
          },
          // Asset-backed: nothing to rebuild, so it is fetched instead.
          { reportId: "doc-a", reportName: "Legacy report", status: "saved", pdfUrl: null },
        ],
      }));
      const { initViewer } = await import("./view-report.js");
      await initViewer(`?bundle=${VALID_TOKEN}`);

      const button = document.querySelector("#share-bundle-download");
      expect(button.textContent).toBe("Download all 3 documents");
      expect(button.disabled).toBe(false);

      button.click();
      await vi.waitFor(() => expect(anchorClick).toHaveBeenCalledTimes(3), { timeout: 5000 });

      // Three downloads, each its own PDF -- nothing bundled or merged.
      expect(await savedDocuments(blobs, anchorClick)).toEqual([
        { name: "01-Summary.pdf", marker: 500 },
        { name: "02-Test-Report-X-1.pdf", marker: 601 },
        { name: "03-Legacy-report.pdf", marker: ASSET_MARKER },
      ]);
      await vi.waitFor(() =>
        expect(document.querySelector("#share-bundle-download-note").textContent).toBe(
          "Downloaded 3 documents. Allow multiple downloads if your browser asks.",
        ),
      );
      expect(button.disabled).toBe(false);
      delete globalThis.docuAlignRakReportPdf;
    });

    it("names what it could not prepare rather than failing the other downloads", async () => {
      const { blobs } = await stubPackageRuntime();
      globalThis.docuAlignSummaryPdf = { createDocument: vi.fn(async () => markerPdf(500)) };
      globalThis.docuAlignRakReportPdf = {
        createRakReportPdf: vi.fn(async () => {
          throw new Error("Template unavailable");
        }),
      };
      const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(() => {});
      // The failing report has no asset to fall back to either.
      fetch.mockReset().mockResolvedValue({ ok: false, status: 404 });
      mockFetchSharedBundle.mockResolvedValueOnce(bundle({
        reports: [
          {
            reportId: "doc-r",
            reportName: "Broken report",
            status: "complete",
            pdfUrl: null,
            documentData: JSON.stringify({ renderer: "report", report: { jobRef: "X-1" } }),
          },
          {
            reportId: "doc-s",
            reportName: "Summary",
            status: "complete",
            pdfUrl: null,
            documentData: JSON.stringify({ renderer: "summary", cells: [] }),
          },
        ],
      }));
      const { initViewer } = await import("./view-report.js");
      await initViewer(`?bundle=${VALID_TOKEN}`);

      document.querySelector("#share-bundle-download").click();
      await vi.waitFor(() => expect(anchorClick).toHaveBeenCalledOnce());

      // The Summary is still delivered; the failure is named, not swallowed.
      expect(await savedDocuments(blobs, anchorClick)).toEqual([
        { name: "01-Summary.pdf", marker: 500 },
      ]);
      await vi.waitFor(() =>
        expect(document.querySelector("#share-bundle-download-note").textContent).toBe(
          "Downloaded 1 document; could not prepare Broken report.",
        ),
      );
      delete globalThis.docuAlignRakReportPdf;
    });

    it("names a packaged document whose title has no usable characters", async () => {
      const { blobs } = await stubPackageRuntime();
      const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(() => {});
      mockFetchSharedBundle.mockResolvedValueOnce(bundle({
        reports: [
          { reportId: "doc-1", reportName: "***", status: null, pdfUrl: null },
          { reportId: "doc-2", reportName: null, status: null, pdfUrl: null },
        ],
      }));
      const { initViewer } = await import("./view-report.js");
      await initViewer(`?bundle=${VALID_TOKEN}`);

      document.querySelector("#share-bundle-download").click();
      await vi.waitFor(() => expect(anchorClick).toHaveBeenCalledTimes(2), { timeout: 5000 });

      // Numbered, so two unnameable documents still save as separate files.
      expect((await savedDocuments(blobs, anchorClick)).map((entry) => entry.name)).toEqual([
        "01-document.pdf",
        "02-document.pdf",
      ]);
    });

    it("releases each download's object URL after the grace period", async () => {
      await stubPackageRuntime();
      const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(() => {});
      mockFetchSharedBundle.mockResolvedValueOnce(bundle({
        reports: [{ reportId: "doc-1", reportName: "a", status: null, pdfUrl: null }],
      }));
      const { initViewer } = await import("./view-report.js");
      await initViewer(`?bundle=${VALID_TOKEN}`);

      vi.useFakeTimers();
      try {
        document.querySelector("#share-bundle-download").click();
        // The rebuild settles on the microtask queue, which fake timers do
        // not gate; advancing by zero lets it finish before the check.
        await vi.advanceTimersByTimeAsync(0);
        expect(anchorClick).toHaveBeenCalledOnce();
        expect(URL.revokeObjectURL).not.toHaveBeenCalled();

        // Held long enough for the browser to take the download, then released.
        await vi.advanceTimersByTimeAsync(60000);
        expect(URL.revokeObjectURL).toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("prints every packaged document as one job from a single button", async () => {
      const { blobs } = await stubPackageRuntime();
      await import("./pdf-merge.js");
      globalThis.PDFLib = PDFLib;
      globalThis.docuAlignSummaryPdf = { createDocument: vi.fn(async () => markerPdf(500)) };
      globalThis.docuAlignRakReportPdf = {
        createRakReportPdf: vi.fn(async ([report]) => new Blob(
          [await markerPdf(Number(report.marker))],
          { type: "application/pdf" },
        )),
      };
      mockFetchSharedBundle.mockResolvedValueOnce(bundle({
        reports: [
          {
            reportId: "doc-r",
            reportName: "Test Report X-1",
            status: "complete",
            pdfUrl: null,
            documentData: JSON.stringify({
              renderer: "report",
              report: { marker: 601, cover: { samplingDate: "08/04/2026" } },
            }),
          },
          {
            reportId: "doc-s",
            reportName: "Summary",
            status: "complete",
            pdfUrl: null,
            documentData: JSON.stringify({ renderer: "summary", cells: [] }),
          },
        ],
      }));
      const { initViewer } = await import("./view-report.js");
      await initViewer(`?bundle=${VALID_TOKEN}`);

      const button = document.querySelector("#share-bundle-print");
      expect(button.textContent).toBe("Print all 2 documents");

      button.click();
      await vi.waitFor(() => expect(document.querySelector("iframe.print-frame")).not.toBeNull());

      // A print job is one document by definition, so the two are merged --
      // but only for the printer: nothing is downloaded.
      const printed = await PDFLib.PDFDocument.load(await blobs.at(-1).arrayBuffer());
      expect(printed.getPages().map((page) => Math.round(page.getWidth())))
        .toEqual([500, 601]);

      // The frame is handed the merged PDF and asked to print it.
      const frame = document.querySelector("iframe.print-frame");
      const print = vi.fn();
      Object.defineProperty(frame, "contentWindow", {
        configurable: true,
        value: { focus: vi.fn(), print },
      });
      frame.dispatchEvent(new Event("load"));
      expect(print).toHaveBeenCalledOnce();

      await vi.waitFor(() =>
        expect(document.querySelector("#share-bundle-download-note").textContent).toBe(
          "Sent 2 documents to your printer as one job.",
        ),
      );
      expect(button.disabled).toBe(false);
      delete globalThis.docuAlignRakReportPdf;
    });

    it("prints what it can and names what it could not prepare", async () => {
      await stubPackageRuntime();
      await import("./pdf-merge.js");
      globalThis.PDFLib = PDFLib;
      globalThis.docuAlignSummaryPdf = { createDocument: vi.fn(async () => markerPdf(500)) };
      globalThis.docuAlignRakReportPdf = {
        createRakReportPdf: vi.fn(async () => {
          throw new Error("Template unavailable");
        }),
      };
      fetch.mockReset().mockResolvedValue({ ok: false, status: 404 });
      mockFetchSharedBundle.mockResolvedValueOnce(bundle({
        reports: [
          {
            reportId: "doc-r",
            reportName: "Broken report",
            status: "complete",
            pdfUrl: null,
            documentData: JSON.stringify({ renderer: "report", report: { jobRef: "X-1" } }),
          },
          // Nameless and also unrebuildable: it still has to be named to the
          // recipient somehow.
          { reportId: "doc-n", reportName: null, status: "complete", pdfUrl: null },
          {
            reportId: "doc-s",
            reportName: "Summary",
            status: "complete",
            pdfUrl: null,
            documentData: JSON.stringify({ renderer: "summary", cells: [] }),
          },
        ],
      }));
      const { initViewer } = await import("./view-report.js");
      await initViewer(`?bundle=${VALID_TOKEN}`);

      document.querySelector("#share-bundle-print").click();

      await vi.waitFor(() =>
        expect(document.querySelector("#share-bundle-download-note").textContent).toBe(
          "Sent 1 document to your printer; could not prepare Broken report, Untitled report.",
        ),
      );
      delete globalThis.docuAlignRakReportPdf;
    });

    it("explains a package that cannot be prepared for printing at all", async () => {
      await stubPackageRuntime();
      await import("./pdf-merge.js");
      globalThis.PDFLib = PDFLib;
      fetch.mockReset().mockResolvedValue({ ok: false, status: 404 });
      mockFetchSharedBundle.mockResolvedValueOnce(
        bundle({ reports: [{ reportId: "doc-1", reportName: "a", status: null, pdfUrl: null }] }),
      );
      const { initViewer } = await import("./view-report.js");
      await initViewer(`?bundle=${VALID_TOKEN}`);

      const button = document.querySelector("#share-bundle-print");
      button.click();

      await vi.waitFor(() =>
        expect(document.querySelector("#share-bundle-download-note").textContent).toBe(
          "These documents could not be prepared. Ask the sender for a new link.",
        ),
      );
      expect(document.querySelector("iframe.print-frame")).toBeNull();
      // Usable again, so a transient failure can be retried.
      expect(button.disabled).toBe(false);
    });

    it("survives a browser that will not expose the print frame's window", async () => {
      await stubPackageRuntime();
      await import("./pdf-merge.js");
      globalThis.PDFLib = PDFLib;
      mockFetchSharedBundle.mockResolvedValueOnce(bundle({
        reports: [{ reportId: "doc-1", reportName: "a", status: null, pdfUrl: null }],
      }));
      const { initViewer } = await import("./view-report.js");
      await initViewer(`?bundle=${VALID_TOKEN}`);

      document.querySelector("#share-bundle-print").click();
      await vi.waitFor(() => expect(document.querySelector("iframe.print-frame")).not.toBeNull());

      // contentWindow is null for a cross-origin or blocked frame, and has no
      // print() where PDFs render without an embedded viewer. Neither may
      // throw, so the per-document links still work.
      const frame = document.querySelector("iframe.print-frame");
      Object.defineProperty(frame, "contentWindow", { configurable: true, value: null });
      expect(() => frame.dispatchEvent(new Event("load"))).not.toThrow();

      Object.defineProperty(frame, "contentWindow", { configurable: true, value: {} });
      expect(() => frame.dispatchEvent(new Event("load"))).not.toThrow();
    });

    it("clears the print frame and its object URL after the grace period", async () => {
      await stubPackageRuntime();
      await import("./pdf-merge.js");
      globalThis.PDFLib = PDFLib;
      mockFetchSharedBundle.mockResolvedValueOnce(bundle({
        reports: [{ reportId: "doc-1", reportName: "a", status: null, pdfUrl: null }],
      }));
      const { initViewer } = await import("./view-report.js");
      await initViewer(`?bundle=${VALID_TOKEN}`);

      vi.useFakeTimers();
      try {
        document.querySelector("#share-bundle-print").click();
        await vi.advanceTimersByTimeAsync(0);
        // Held while the dialog is open: removing it cancels the job.
        expect(document.querySelector("iframe.print-frame")).not.toBeNull();
        expect(URL.revokeObjectURL).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(60000);
        expect(document.querySelector("iframe.print-frame")).toBeNull();
        expect(URL.revokeObjectURL).toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("explains a package whose documents cannot be prepared at all", async () => {
      await stubPackageRuntime();
      const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(() => {});
      fetch.mockReset().mockResolvedValue({ ok: false, status: 404 });
      mockFetchSharedBundle.mockResolvedValueOnce(
        bundle({ reports: [{ reportId: "doc-1", reportName: "", status: null, pdfUrl: null }] }),
      );
      const { initViewer } = await import("./view-report.js");
      await initViewer(`?bundle=${VALID_TOKEN}`);

      const button = document.querySelector("#share-bundle-download");
      button.click();
      await vi.waitFor(() =>
        expect(document.querySelector("#share-bundle-download-note").textContent).toBe(
          "These documents could not be prepared. Ask the sender for a new link.",
        ),
      );
      expect(anchorClick).not.toHaveBeenCalled();
      // The button is usable again, so a transient failure can be retried.
      expect(button.disabled).toBe(false);
    });

    it("renders package fallbacks for a missing name, date, and report title", async () => {
      await stubPackageRuntime();
      mockFetchSharedBundle.mockResolvedValueOnce(
        bundle({
          bundleName: null,
          publishedAt: null,
          reports: [{ reportId: "doc-1", reportName: null, status: null, pdfUrl: null }],
        }),
      );
      const { initViewer } = await import("./view-report.js");

      await initViewer(`?bundle=${VALID_TOKEN}`);

      expect(document.querySelector("#share-bundle-name").textContent).toBe("Shared reports");
      expect(document.querySelector("#share-bundle-count").textContent).toBe("1 document");
      expect(document.querySelector("#share-bundle-published").textContent)
        .toBe("Date unavailable");
      expect(document.querySelector("#share-bundle-download").textContent)
        .toBe("Download all 1 documents");
      const item = document.querySelector("#share-bundle-list li");
      expect(item.textContent).toContain("Untitled report");
      expect(item.textContent).toContain("Report complete");
    });

    it("still rebuilds a packaged legacy Summary through the fixed-format renderer", async () => {
      const { blobs } = await stubPackageRuntime();
      globalThis.docuAlignSummaryPdf = {
        cellsFromDocumentData: vi.fn(() => new Map([["U10", "X-2026-522"]])),
        createDocument: vi.fn(async () => markerPdf(500)),
      };
      const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(() => {});
      mockFetchSharedBundle.mockResolvedValueOnce(
        bundle({
          reports: [{
            reportId: "doc-1",
            reportName: "Summary",
            documentSlug: "Summary",
            status: "saved",
            pdfUrl: null,
            documentData: JSON.stringify([
              { heading: "Summary", columns: ["A"], rows: [["Summary"]] },
            ]),
          }],
        }),
      );
      const { initViewer } = await import("./view-report.js");

      await initViewer(`?bundle=${VALID_TOKEN}`);
      document.querySelector("#share-bundle-download").click();
      await vi.waitFor(() => expect(anchorClick).toHaveBeenCalledOnce());

      expect(globalThis.docuAlignSummaryPdf.createDocument).toHaveBeenCalled();
      expect(await savedDocuments(blobs, anchorClick)).toEqual([
        { name: "01-Summary.pdf", marker: 500 },
      ]);
    });

    it("shows the revoked message when a bundle no longer exists", async () => {
      mockFetchSharedBundle.mockResolvedValueOnce(null);
      const { initViewer } = await import("./view-report.js");

      await initViewer(`?bundle=${VALID_TOKEN}`);

      expect(document.querySelector("#share-bundle").hidden).toBe(true);
      expect(document.querySelector("#share-status").textContent).toContain(
        "This share link is no longer available. Ask the report owner for a new link.",
      );
    });

    it("treats a malformed bundle token as an invalid link", async () => {
      const { initViewer } = await import("./view-report.js");

      await initViewer("?bundle=guessable");

      expect(mockFetchSharedBundle).not.toHaveBeenCalled();
      expect(document.querySelector("#share-status").textContent).toContain(
        "This share link is not valid. Check the URL and try again.",
      );
    });

    it("reports bundle fetch failures with a structured console error", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockFetchSharedBundle.mockRejectedValueOnce(new Error("network down"));
      const { initViewer } = await import("./view-report.js");

      await initViewer(`?bundle=${VALID_TOKEN}`);

      expect(document.querySelector("#share-status").textContent).toContain(
        "Could not load this shared report. Check your connection and try again.",
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        "[DocuAlign] Load shared bundle failed",
        expect.any(Error),
        expect.objectContaining({ feature: "PublicShare", function: "initViewer" }),
      );
      consoleSpy.mockRestore();
    });

    it("defaults to the page URL search and survives a missing location", async () => {
      const { initViewer } = await import("./view-report.js");

      await initViewer();
      expect(document.querySelector("#share-status").textContent).toContain(
        "This share link is not valid. Check the URL and try again.",
      );

      vi.stubGlobal("location", undefined);
      await initViewer();
      expect(document.querySelector("#share-status").textContent).toContain(
        "This share link is not valid. Check the URL and try again.",
      );
      vi.unstubAllGlobals();
      expect(mockFetchSharedReport).not.toHaveBeenCalled();
    });

    it("reports fetch failures with a structured console error", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockFetchSharedReport.mockRejectedValueOnce(new Error("network down"));
      const { initViewer } = await import("./view-report.js");

      await initViewer(`?share=${VALID_TOKEN}`);

      expect(document.querySelector("#share-status").textContent).toContain(
        "Could not load this shared report. Check your connection and try again.",
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        "[DocuAlign] Load shared report failed",
        expect.any(Error),
        expect.objectContaining({ feature: "PublicShare", function: "initViewer" }),
      );
      consoleSpy.mockRestore();
    });
  });
});
