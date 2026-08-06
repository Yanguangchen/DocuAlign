/**
 * @file workspace.test.js
 * @description Behavioral coverage for the primary workspace controller,
 * including file selection, real workbook parsing, drag/drop, the two-document
 * PDF export, and the direct-file runtime notice.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as PDFLib from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const workbookBytes = readFileSync(resolve(".", "SampleDocuments/SampleInput.xlsx"));

/**
 * A one-page PDF whose page width identifies which document produced it.
 *
 * Every archived entry is a real PDF, so the way to assert which document
 * landed where is to make each one recognisable by its page width.
 * @param {number} width - The marker width, unique per document.
 * @returns {Promise<Uint8Array>} A valid single-page PDF.
 */
async function markerPdf(width) {
  const pdf = await PDFLib.PDFDocument.create();
  pdf.addPage([width, 100]);
  return pdf.save();
}

/**
 * Read back a ZIP archive's stored entries. Only the format the workspace
 * itself writes needs supporting: local headers holding uncompressed data,
 * scanned until the central directory begins.
 * @param {Uint8Array} bytes - Archive bytes.
 * @returns {Array<{name: string, data: Uint8Array}>} Stored entries, in order.
 */
function readZipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const entries = [];
  let offset = 0;

  while (view.getUint32(offset, true) === 0x04034b50) {
    const nameLength = view.getUint16(offset + 26, true);
    const dataLength = view.getUint32(offset + 22, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength;
    entries.push({
      name: decoder.decode(bytes.subarray(nameStart, dataStart)),
      data: bytes.subarray(dataStart, dataStart + dataLength),
    });
    offset = dataStart + dataLength;
  }
  return entries;
}

/**
 * The archive most recently handed to `URL.createObjectURL` by the export
 * button, decoded into its stored entries.
 * @returns {Promise<Array<{name: string, data: Uint8Array}>>} Archive entries.
 */
async function downloadedArchiveEntries() {
  const [blob] = URL.createObjectURL.mock.calls.at(-1);
  return readZipEntries(new Uint8Array(await blob.arrayBuffer()));
}

/**
 * Each archived document's own page-width marker, in archive order. The
 * documents stay separate PDFs, so each entry is read as its own file.
 * @returns {Promise<number[]>} One marker per archived document.
 */
async function downloadedDocumentMarkers() {
  const entries = await downloadedArchiveEntries();
  return Promise.all(entries.map(async (entry) => {
    const pdf = await PDFLib.PDFDocument.load(entry.data);
    return Math.round(pdf.getPage(0).getWidth());
  }));
}

function renderWorkspace() {
  document.body.innerHTML = `
    <input id="excel-file" type="file" />
    <div id="dropzone"><div id="dropzone-prompt"><strong id="dropzone-title"></strong></div></div>
    <div id="selected-file" hidden></div>
    <span id="file-name"></span>
    <span id="file-meta"></span>
    <div id="feedback"></div>
    <section id="pipeline-step"></section>
    <p id="pipeline-copy"></p>
    <span id="pipeline-state"></span>
    <div class="pipeline-stage"></div>
    <div class="pipeline-stage"></div>
    <div class="pipeline-stage"></div>
    <section id="export-step"></section>
    <button id="pdf-export"></button>
    <section id="save-step"></section>
    <button id="cloud-save"></button>
    <button id="replace-file"></button>
    <button id="remove-file"></button>
    <button id="google-sign-in"></button>
    <p id="auth-message"></p>
  `;
}

/**
 * Build a File carrying the real sample workbook bytes so the controller
 * exercises the actual parser rather than a stub.
 * @param {string} name - File name.
 * @param {number} [size] - Optional reported size override.
 * @returns {File} The workbook file.
 */
function workbook(name = "lab-data.xlsx", size) {
  const file = new File([workbookBytes], name);
  if (size !== undefined) Object.defineProperty(file, "size", { value: size });
  return file;
}

/** Page-width marker each stubbed renderer stamps on its document. */
const SUMMARY_MARKER = 500;
const ASSET_MARKER = 700;
/** The generic writer's own landscape A4 width, which needs no stubbing. */
const GENERIC_MARKER = 842;
const reportMarker = (groupIndex) => 600 + groupIndex;

/**
 * The marker PDF's bytes as a standalone ArrayBuffer, for a `fetch` stub.
 * @param {number} width - The marker width.
 * @returns {Promise<ArrayBuffer>} The PDF's own buffer.
 */
async function markerPdfBuffer(width) {
  const bytes = await markerPdf(width);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

async function loadWorkspace() {
  await import("./xlsx-reader.js");
  await import("./pdf-writer.js");
  await import("./summary-pdf.js");
  await import("./zip-writer.js");
  // The archive stores real PDFs, so the renderers must produce real ones.
  globalThis.PDFLib = PDFLib;
  globalThis.docuAlignSummaryPdf = {
    createDocument: vi.fn(async () => markerPdf(SUMMARY_MARKER)),
  };
  await import("./workspace.js");
  return globalThis.docuAlignWorkspace;
}

/**
 * Load the workspace with the report mapping and overlay renderers present,
 * as the browser does. The overlay itself is stubbed: `rak-report-pdf.test.js`
 * covers the real rendering, and this only needs the wiring exercised.
 * @returns {Promise<Object>} The workspace API.
 */
async function loadMappedWorkspace() {
  await import("./report-mapping.js");
  globalThis.docuAlignRakReportPdf = {
    createRakReportPdf: vi.fn(async ([model]) => new Blob(
      [await markerPdf(reportMarker(model.groupIndex))],
      { type: "application/pdf" },
    )),
  };
  return loadWorkspace();
}

/**
 * Replace the reader global so pipeline edge cases can be driven directly.
 * @param {Object} stub - Partial reader implementation.
 * @returns {void}
 */
function stubReader(stub) {
  globalThis.docuAlignXlsx = Object.assign({}, globalThis.docuAlignXlsx, stub);
}

describe("workspace controller", () => {
  beforeEach(() => {
    vi.resetModules();
    delete globalThis.docuAlignWorkspace;
    delete globalThis.docuAlignXlsx;
    delete globalThis.docuAlignPdf;
    delete globalThis.docuAlignSummaryPdf;
    delete globalThis.docuAlignReportMapping;
    delete globalThis.docuAlignRakReportPdf;
    delete globalThis.docuAlignLogger;
    delete globalThis.PDFLib;
    delete globalThis.docuAlignZip;
    vi.stubGlobal("URL", Object.assign(globalThis.URL, {
      createObjectURL: vi.fn(() => "blob:generated"),
      revokeObjectURL: vi.fn(),
    }));
    // Reports without a mapped model fall back to fetching the reference
    // asset for the archive, so every test gets a working default; tests that
    // care about the fetched bytes or a fetch failure override this.
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => markerPdfBuffer(ASSET_MARKER),
    })));
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderWorkspace();
  });

  afterEach(() => {
    delete globalThis.docuAlignWorkspace;
    delete globalThis.docuAlignXlsx;
    delete globalThis.docuAlignPdf;
    delete globalThis.docuAlignSummaryPdf;
    delete globalThis.docuAlignReportMapping;
    delete globalThis.docuAlignRakReportPdf;
    delete globalThis.docuAlignLogger;
    delete globalThis.PDFLib;
    delete globalThis.docuAlignZip;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("formats file sizes and identifies both supported workbook extensions", async () => {
    const { formatFileSize, isExcelFile } = await loadWorkspace();

    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2.0 KB");
    expect(formatFileSize(2 * 1024 * 1024)).toBe("2.0 MB");
    expect(isExcelFile(workbook("REPORT.XLSX"))).toBe(true);
    expect(isExcelFile(workbook("legacy.xls"))).toBe(true);
    expect(isExcelFile(workbook("report.pdf"))).toBe(false);
  });

  it("ignores an empty selection and rejects unsupported files", async () => {
    const { selectFile } = await loadWorkspace();

    expect(selectFile(null)).toBeUndefined();
    expect(selectFile(workbook("report.pdf"))).toBeUndefined();

    expect(document.querySelector("#feedback").textContent).toContain("Choose an Excel workbook");
    expect(document.querySelector("#feedback").classList).toContain("is-visible");
    expect(document.querySelector("#selected-file").hidden).toBe(true);
    expect(document.querySelector("#pdf-export").disabled).toBe(true);
  });

  it("parses the real workbook and reports every detected test report", async () => {
    const { selectFile } = await loadWorkspace();

    const pipeline = selectFile(workbook("lab-data.xlsx", 2048));
    expect(document.querySelector("#file-name").textContent).toBe("lab-data.xlsx");
    expect(document.querySelector("#file-meta").textContent).toBe("2.0 KB / Processing started");
    expect(document.querySelector("#pipeline-state").textContent).toBe("Processing");
    await pipeline;

    // SampleInput.xlsx holds six CV1/TR1/DS1/SB1 groups across 26 worksheets.
    expect(document.querySelector("#pipeline-copy").textContent).toBe(
      "Parsed 6 test reports from 26 worksheets.",
    );
    expect(document.querySelector("#pipeline-state").textContent).toBe("Complete");
    expect(document.querySelector("#pipeline-step").classList).toContain("is-complete");
    expect(document.querySelector("#pdf-export").disabled).toBe(false);
    // Datasheet and standalone-worksheet exports are temporarily withheld, so
    // the six test reports and the Summary are all that export today.
    expect(document.querySelector("#feedback").textContent).toBe(
      "ETL complete. Export produces 7 separate PDFs.",
    );
  });

  it("advances each visible pipeline stage", async () => {
    const { advancePipeline } = await loadWorkspace();
    const stages = [...document.querySelectorAll(".pipeline-stage")];

    advancePipeline(1, "Transforming values into the report data model.");
    expect(stages[0].classList).toContain("is-complete");
    expect(stages[1].classList).toContain("is-active");
    expect(stages[2].classList).not.toContain("is-active");
    expect(document.querySelector("#pipeline-copy").textContent).toContain("Transforming");
  });

  it("uses the singular wording for a workbook holding one report", async () => {
    const { selectFile } = await loadWorkspace();
    stubReader({
      readWorkbook: () => ({
        sheetNames: ["CV1", "TR1"],
        cells: new Map(),
        sheets: new Map([
          ["CV1", new Map([["A1", "Client"]])],
          ["TR1", new Map([["A1", "Results"]])],
        ]),
        reportGroups: [{ group: 1, sheets: { CV1: "CV1", TR1: "TR1" } }],
      }),
      extractReportIdentity: () => ({ job_ref: "X-1" }),
    });

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await selectFile(workbook("single.xlsx"));
    expect(document.querySelector("#pipeline-copy").textContent).toBe(
      "Parsed 1 test report from 2 worksheets.",
    );
    expect(document.querySelector("#feedback").textContent).toBe(
      "ETL complete. Export produces 1 separate PDF.",
    );
    expect(document.querySelector("#pdf-export").disabled).toBe(false);

    document.querySelector("#pdf-export").click();
    await vi.waitFor(() => expect(clickSpy).toHaveBeenCalledOnce());

    expect(document.querySelector("#feedback").textContent).toBe(
      "Downloaded single.zip with 1 document. Cloud save is now available.",
    );
    expect(clickSpy.mock.contexts[0].download).toBe("single.zip");
  });

  it("fails the pipeline when the workbook holds no complete report groups", async () => {
    const { selectFile } = await loadWorkspace();
    stubReader({
      readWorkbook: () => ({ sheetNames: ["Summary"], cells: new Map(), reportGroups: [] }),
    });

    await selectFile(workbook("empty.xlsx"));
    expect(document.querySelector("#pipeline-state").textContent).toBe("Failed");
    expect(document.querySelector("#pipeline-copy").textContent).toContain(
      "No complete CV1/TR1/DS1/SB1",
    );
    expect(document.querySelector("#pdf-export").disabled).toBe(true);
  });

  it("fails the pipeline when the workbook cannot be read", async () => {
    const { selectFile } = await loadWorkspace();
    stubReader({
      readWorkbook: () => {
        throw new Error("Workbook is not a readable .xlsx archive.");
      },
    });

    await selectFile(workbook("corrupt.xlsx"));
    expect(document.querySelector("#pipeline-state").textContent).toBe("Failed");
    expect(document.querySelector("#feedback").textContent).toContain("not a readable .xlsx");
    expect(document.querySelector("#pdf-export").disabled).toBe(true);
  });

  it("resets the workspace and discards parsed reports", async () => {
    const { clearFile, selectFile } = await loadWorkspace();
    const input = document.querySelector("#excel-file");

    await selectFile(workbook());
    Object.defineProperty(input, "value", { value: "selected", writable: true });
    clearFile();

    expect(input.value).toBe("");
    expect(document.querySelector("#dropzone-prompt").hidden).toBe(false);
    expect(document.querySelector("#pipeline-state").textContent).toBe("Waiting");
    expect(document.querySelector("#cloud-save").disabled).toBe(true);

    // The export must re-lock once the parsed workbook is discarded; force the
    // button back on to prove the handler guards on state, not just the attribute.
    const exportButton = document.querySelector("#pdf-export");
    expect(exportButton.disabled).toBe(true);
    exportButton.disabled = false;
    exportButton.click();
    expect(document.querySelector("#feedback").textContent).toContain("before exporting");
  });

  it("wires replace and remove controls", async () => {
    await loadWorkspace();
    const input = document.querySelector("#excel-file");
    const clickSpy = vi.spyOn(input, "click").mockImplementation(() => {});

    document.querySelector("#replace-file").click();
    expect(clickSpy).toHaveBeenCalledOnce();

    document.querySelector("#remove-file").click();
    expect(document.querySelector("#feedback").textContent).toContain("Select a workbook");
    expect(document.querySelector("#feedback").classList).not.toContain("is-visible");
  });

  it("handles input changes and drag/drop interaction states", async () => {
    const { clearFile } = await loadWorkspace();
    // Choosing or dropping a file now runs the export too, and a real click on
    // the download anchor would navigate happy-dom to the stubbed blob URL --
    // breaking relative asset resolution for every test that follows.
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const input = document.querySelector("#excel-file");
    const dropzone = document.querySelector("#dropzone");
    const file = workbook("drop.xls");
    Object.defineProperty(input, "files", { value: [file] });
    input.dispatchEvent(new Event("change"));
    // Choosing a file now runs the whole workflow, so settle it before moving
    // on -- an export still in flight would otherwise leak into the next test.
    // The wait names this workbook's own archive, since a later drop would
    // otherwise match feedback this one already left behind.
    await vi.waitFor(() =>
      expect(document.querySelector("#feedback").textContent).toContain("drop.zip"));
    expect(document.querySelector("#pipeline-state").textContent).toBe("Complete");
    expect(document.querySelector("#file-name").textContent).toBe("drop.xls");

    const dragEnter = new Event("dragenter", { cancelable: true });
    dropzone.dispatchEvent(dragEnter);
    expect(dragEnter.defaultPrevented).toBe(true);
    expect(dropzone.classList).toContain("is-dragging");

    const dragOver = new Event("dragover", { cancelable: true });
    dropzone.dispatchEvent(dragOver);
    expect(dragOver.defaultPrevented).toBe(true);

    const childLeave = new Event("dragleave");
    Object.defineProperty(childLeave, "relatedTarget", {
      value: document.querySelector("#dropzone-title"),
    });
    dropzone.dispatchEvent(childLeave);
    expect(dropzone.classList).toContain("is-dragging");

    const outerLeave = new Event("dragleave");
    Object.defineProperty(outerLeave, "relatedTarget", { value: document.body });
    dropzone.dispatchEvent(outerLeave);
    expect(dropzone.classList).not.toContain("is-dragging");

    const drop = new Event("drop", { cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: { files: [workbook("dropped.xlsx")] } });
    dropzone.dispatchEvent(drop);
    await vi.waitFor(() =>
      expect(document.querySelector("#feedback").textContent).toContain("dropped.zip"));
    expect(document.querySelector("#pipeline-state").textContent).toBe("Complete");
    expect(drop.defaultPrevented).toBe(true);
    expect(document.querySelector("#file-name").textContent).toBe("dropped.xlsx");
    clearFile();
  });

  it("blocks premature export, then downloads one archive holding every document", async () => {
    const { clearFile, selectFile } = await loadWorkspace();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const exportButton = document.querySelector("#pdf-export");

    exportButton.click();
    expect(document.querySelector("#feedback").textContent).toContain("before exporting");
    expect(clickSpy).not.toHaveBeenCalled();

    await selectFile(workbook("Client Sample 01.xlsx"));
    exportButton.click();
    await vi.waitFor(() => expect(clickSpy).toHaveBeenCalledOnce());

    // Six reports + the Summary. The DS1/SB1 datasheets and the coral + org
    // worksheet are temporarily withheld from the export.
    expect(globalThis.docuAlignSummaryPdf.createDocument).toHaveBeenCalledOnce();
    expect(clickSpy.mock.contexts[0].download).toBe("Client-Sample-01.zip");
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    expect(URL.createObjectURL.mock.calls[0][0].type).toBe("application/zip");

    // Each document is its own entry, named into a folder so the archive
    // unpacks tidily. The Summary leads, then the six reports; the DS1/SB1
    // datasheets and the coral + org worksheet are temporarily withheld.
    const names = (await downloadedArchiveEntries()).map((entry) => entry.name);
    expect(names).toEqual([
      "Client-Sample-01/Client-Sample-01-Summary.pdf",
      ...[1, 2, 3, 4, 5, 6].map(
        (group) => `Client-Sample-01/Client-Sample-01-X-2026-522-${group}.pdf`,
      ),
    ]);
    expect(names.some((name) => /-DS1\.pdf$|-SB1\.pdf$/.test(name))).toBe(false);
    expect(names).not.toContain("Client-Sample-01/Client-Sample-01-coral-org.pdf");
    // Without the mapping renderer loaded, each report falls back to the
    // reference asset, so all six carry that marker.
    expect(await downloadedDocumentMarkers()).toEqual([
      SUMMARY_MARKER,
      ...Array.from({ length: 6 }, () => ASSET_MARKER),
    ]);
    // The six test reports keep their established layout: each is fetched
    // from the reference asset rather than generated.
    expect(fetch).toHaveBeenCalledTimes(6);
    fetch.mock.calls.forEach(([url]) => expect(url).toContain("SampleOutput.pdf"));

    expect(document.querySelector("#feedback").textContent).toBe(
      "Downloaded Client-Sample-01.zip with 7 documents. Cloud save is now available.",
    );
    expect(document.querySelector("#cloud-save").disabled).toBe(false);
    clearFile();
  });

  it("releases the archive's object URL after the grace period", async () => {
    const { selectFile } = await loadWorkspace();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await selectFile(workbook("lab-data.xlsx"));
    vi.useFakeTimers();
    document.querySelector("#pdf-export").click();
    // Let the fetch/render promise chain settle before checking the timer;
    // it resolves on the microtask queue, which fake timers do not gate.
    await vi.advanceTimersByTimeAsync(0);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60000);
    vi.useRealTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:generated");
  });

  /**
   * A workbook holding exactly one report and nothing else, so a build's
   * single fetch call can be held open and released on demand.
   * @returns {void}
   */
  function stubSingleReportWorkbook() {
    stubReader({
      readWorkbook: () => ({
        sheetNames: ["CV1", "TR1"],
        cells: new Map(),
        sheets: new Map([
          ["CV1", new Map([["A1", "Client"]])],
          ["TR1", new Map([["A1", "Results"]])],
        ]),
        reportGroups: [{ group: 1, sheets: { CV1: "CV1", TR1: "TR1" } }],
      }),
      extractReportIdentity: () => ({ job_ref: "X-1" }),
    });
  }

  it("disables the button for the build's duration, blocking a repeat click", async () => {
    const { selectFile } = await loadWorkspace();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const exportButton = document.querySelector("#pdf-export");
    let releaseFetch;
    fetch.mockImplementationOnce(() => new Promise((resolve) => {
      releaseFetch = () => resolve({
        ok: true,
        arrayBuffer: async () => markerPdfBuffer(ASSET_MARKER),
      });
    }));
    stubSingleReportWorkbook();
    await selectFile(workbook("single.xlsx"));

    exportButton.click();
    expect(exportButton.disabled).toBe(true);

    // A disabled button does not dispatch click at all (the click() algorithm
    // no-ops for it), so a repeat click here starts no second build; only one
    // archive is ever produced for this export.
    exportButton.click();
    releaseFetch();
    await vi.waitFor(() => expect(clickSpy).toHaveBeenCalledOnce());
    expect(fetch).toHaveBeenCalledOnce();
    expect(exportButton.disabled).toBe(false);
  });

  it("drops the archive when the workbook is reset before the build finishes", async () => {
    const { clearFile, selectFile } = await loadWorkspace();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    let releaseFetch;
    fetch.mockImplementationOnce(() => new Promise((resolve) => {
      releaseFetch = () => resolve({
        ok: true,
        arrayBuffer: async () => markerPdfBuffer(ASSET_MARKER),
      });
    }));
    stubSingleReportWorkbook();
    await selectFile(workbook("single.xlsx"));

    // Packing the archive is the build's last step before it decides whether
    // to download, so it is the point to wait for here. The zip writer's API
    // is frozen, so it is wrapped rather than spied on in place.
    const packed = vi.fn(globalThis.docuAlignZip.createArchive);
    globalThis.docuAlignZip = { createArchive: packed };
    document.querySelector("#pdf-export").click();
    // The workbook is cleared while the fetch for its report is still pending.
    clearFile();
    releaseFetch();
    await vi.waitFor(() => expect(packed).toHaveBeenCalledOnce());

    // No download for a workbook that is no longer selected, and the export
    // button stays disabled -- clearFile()'s own reset, left undisturbed.
    expect(clickSpy).not.toHaveBeenCalled();
    expect(document.querySelector("#pdf-export").disabled).toBe(true);
  });

  it("reports a build failure that touches no document, without disturbing a newer workbook", async () => {
    const { selectFile } = await loadWorkspace();
    let rejectFetch;
    fetch.mockImplementationOnce(() => new Promise((_resolve, reject) => {
      rejectFetch = reject;
    }));
    stubSingleReportWorkbook();
    await selectFile(workbook("single.xlsx"));

    document.querySelector("#pdf-export").click();
    // A second workbook is selected before the failing build settles; the
    // failure belongs to the first click and must not touch the new state.
    await selectFile(workbook("single.xlsx"));
    const feedbackBeforeRejection = document.querySelector("#feedback").textContent;
    rejectFetch(new Error("network down"));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());

    expect(document.querySelector("#feedback").textContent).toBe(feedbackBeforeRejection);
  });

  it("reports a build failure for the current workbook when every document fails", async () => {
    const { selectFile } = await loadWorkspace();
    fetch.mockResolvedValue({ ok: false, status: 503 });
    stubSingleReportWorkbook();

    await selectFile(workbook("single.xlsx"));
    document.querySelector("#pdf-export").click();

    await vi.waitFor(() =>
      expect(document.querySelector("#feedback").textContent).toBe(
        "Could not build the export. No document could be generated.",
      ));
    expect(document.querySelector("#pdf-export").disabled).toBe(false);
  });

  it("plans the test report and the Summary while datasheets stay disabled", async () => {
    const { planExportDocuments, reportIdentifier } = await loadWorkspace();
    const reports = [
      {
        group: 1,
        job_ref: "X-1",
        client_name: "Xinsha",
        vessel_name: "JIAHE 99",
        sheets: { CV1: "CV1", TR1: "TR1", DS1: "DS1 ", SB1: "SB1 " },
      },
    ];

    const plan = planExportDocuments({ sheetNames: ["Summary", "CV1", "TR1", "DS1 ", "SB1 "] }, reports);
    expect(plan.map((entry) => entry.slug)).toEqual(["X-1", "Summary"]);
    // The report keeps its established layout: served from the reference asset,
    // never re-rendered from the CV1/TR1 worksheet grids.
    expect(plan[0].assetPath).toBe("./SampleDocuments/SampleOutput.pdf");
    expect(plan[0].sheets).toEqual([]);
    // Its CV1 and TR1 sheets are claimed, so they never export on their own.
    expect(plan.some((entry) => entry.sheets.includes("CV1"))).toBe(false);
    expect(plan.some((entry) => entry.sheets.includes("TR1"))).toBe(false);
    expect(plan[1].title).toBe("Summary");
    expect(plan[1].renderer).toBe("summary");

    // A report without a job reference falls back to its group number.
    expect(reportIdentifier({ group: 3 })).toBe("report-3");
    expect(reportIdentifier({ group: 1, job_ref: "X/2026 522" })).toBe("X-2026-522");
  });

  it("builds every test report from its own worksheet group", async () => {
    const { getExportDocuments, selectFile } = await loadMappedWorkspace();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await selectFile(workbook("lab-data.xlsx"));
    const documents = getExportDocuments();

    // Each report now publishes its own mapped model instead of pointing at
    // the shared reference asset.
    const first = documents.find((entry) => entry.slug === "X-2026-522-1");
    const sixth = documents.find((entry) => entry.slug === "X-2026-522-6");
    expect(first.assetPath).toBeNull();
    const firstModel = JSON.parse(first.data);
    const sixthModel = JSON.parse(sixth.data);
    expect(firstModel.renderer).toBe("report");
    expect(firstModel.report.jobRef).toBe("X-2026-522-1");
    expect(firstModel.report.cover.sampleId).toBe("2-C");
    expect(sixthModel.report.jobRef).toBe("X-2026-522-6");
    expect(sixthModel.report.cover.sampleId).toBe("5-B");
    expect(firstModel.report.cover.clientName).toBe("Xinsha Holding Pte Ltd");
    // The published payload must stay within the public share bound, which
    // means the workbook's pictures travel as metadata rather than bytes.
    expect(first.data.length).toBeLessThanOrEqual(100000);
    expect(firstModel.report.appendix.photos).toHaveLength(2);
    firstModel.report.appendix.photos.forEach((photo) => {
      expect(photo.mimeType).toBe("image/jpeg");
      expect(photo.bytes).toBeUndefined();
    });
    expect(firstModel.report.assets.preparedSignature.bytes).toBeUndefined();

    document.querySelector("#pdf-export").click();
    await vi.waitFor(() => expect(clickSpy).toHaveBeenCalledOnce());

    // Every report is generated now, so the reference asset is never fetched.
    expect(fetch).not.toHaveBeenCalled();
    expect(globalThis.docuAlignRakReportPdf.createRakReportPdf).toHaveBeenCalledTimes(6);
    const renderedJobRefs = globalThis.docuAlignRakReportPdf.createRakReportPdf.mock.calls.map(
      ([reports]) => reports[0].jobRef,
    );
    expect(renderedJobRefs).toEqual([
      "X-2026-522-1",
      "X-2026-522-2",
      "X-2026-522-3",
      "X-2026-522-4",
      "X-2026-522-5",
      "X-2026-522-6",
    ]);
  });

  it("publishes a report from a workbook that carries no pictures", async () => {
    const { getExportDocuments, selectFile } = await loadMappedWorkspace();
    // A workbook whose sheets hold no signatures or photographs at all: the
    // published payload must still describe the report, with nothing to strip.
    globalThis.docuAlignReportMapping = {
      buildMappedReports: () => [
        { groupIndex: 1, jobRef: "X-9", cover: { clientName: "Acme" }, assets: {} },
      ],
    };

    await selectFile(workbook("no-pictures.xlsx"));
    const report = getExportDocuments().find((entry) => entry.slug === "X-2026-522-1");
    const published = JSON.parse(report.data);

    expect(published.report.assets).toEqual({
      preparedSignature: undefined,
      authorisedSignature: undefined,
    });
    expect(published.report.appendix.photos).toEqual([]);
  });

  it("falls back to the reference report when the workbook cannot be mapped", async () => {
    const { getExportDocuments, selectFile } = await loadMappedWorkspace();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    globalThis.docuAlignLogger = { logWarn: vi.fn() };
    // A group the mapper rejects: the reader found CV1/TR1 sheets under names
    // the semantic mapper does not recognise.
    stubReader({
      readWorkbook: () => ({
        sheetNames: ["Cover", "Results"],
        cells: new Map(),
        sheets: new Map([["Cover", new Map()], ["Results", new Map()]]),
        reportGroups: [{ group: 1, sheets: { CV1: "Cover", TR1: "Results" } }],
      }),
      extractReportIdentity: () => ({ job_ref: "X-9" }),
    });

    await selectFile(workbook("unmappable.xlsx"));
    const [report] = getExportDocuments();
    expect(report.assetPath).toBe("./SampleDocuments/SampleOutput.pdf");
    expect(report.data).toBeNull();
    expect(globalThis.docuAlignLogger.logWarn).toHaveBeenCalledWith(
      "Workbook could not be mapped to report models",
      expect.any(Error),
      expect.objectContaining({ feature: "ReportMapping" }),
    );

    document.querySelector("#pdf-export").click();
    await vi.waitFor(() => expect(clickSpy).toHaveBeenCalledOnce());
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("SampleOutput.pdf"));
    expect(globalThis.docuAlignRakReportPdf.createRakReportPdf).not.toHaveBeenCalled();
  });

  it("reports a test report generation failure without blocking other exports", async () => {
    const { selectFile } = await loadMappedWorkspace();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    globalThis.docuAlignRakReportPdf.createRakReportPdf.mockRejectedValueOnce(
      new Error("Template unavailable"),
    );
    globalThis.docuAlignLogger = { logError: vi.fn() };

    await selectFile(workbook("lab-data.xlsx"));
    document.querySelector("#pdf-export").click();

    // The other six documents (five reports + Summary) are still worth
    // having, so the failure of one does not stop the merge.
    await vi.waitFor(() =>
      expect(document.querySelector("#feedback").textContent).toBe(
        "Downloaded lab-data.zip with 6 documents; could not generate Test Report X-2026-522-1.",
      ),
    );
    expect(clickSpy).toHaveBeenCalledOnce();
    // Group 1 is missing; the rest still follow the Summary in order.
    expect(await downloadedDocumentMarkers()).toEqual([
      SUMMARY_MARKER,
      ...[2, 3, 4, 5, 6].map(reportMarker),
    ]);
    expect(globalThis.docuAlignLogger.logError).toHaveBeenCalledWith(
      "Test report PDF generation failed",
      expect.any(Error),
      expect.objectContaining({
        feature: "PdfTemplate",
        operation: "pdf.copyAndOverlay",
        documentSlug: "X-2026-522-1",
      }),
    );
  });

  it("plans the disabled documents again once the restriction is lifted", async () => {
    const { DOCUMENT_KINDS, planExportDocuments, setDisabledDocumentKinds } = await loadWorkspace();
    const reports = [
      { group: 1, job_ref: "X-1", sheets: { CV1: "CV1", TR1: "TR1", DS1: "DS1 ", SB1: "SB1 " } },
    ];
    const workbookSheets = { sheetNames: ["Summary", "CV1", "TR1", "DS1 ", "SB1 ", "coral + org"] };

    // Default: only the fixed-format report and the Summary are exportable.
    expect(planExportDocuments(workbookSheets, reports).map((entry) => entry.kind)).toEqual([
      DOCUMENT_KINDS.REPORT,
      DOCUMENT_KINDS.SUMMARY,
    ]);

    // The planning code for the withheld documents is intact, so clearing the
    // restriction restores the full export with no other change.
    expect(setDisabledDocumentKinds([])).toEqual([]);
    const full = planExportDocuments(workbookSheets, reports);
    expect(full.map((entry) => entry.slug)).toEqual([
      "X-1",
      "X-1-DS1",
      "X-1-SB1",
      "Summary",
      "coral-org",
    ]);
    expect(full[1].title).toBe("DS1 Datasheet X-1");
    expect(full[1].sheets).toEqual(["DS1 "]);
    expect(full[2].kind).toBe(DOCUMENT_KINDS.DATASHEET);
    expect(full[4].kind).toBe(DOCUMENT_KINDS.WORKSHEET);

    // Restoring the default restriction withholds them again.
    expect(setDisabledDocumentKinds()).toEqual([
      DOCUMENT_KINDS.DATASHEET,
      DOCUMENT_KINDS.WORKSHEET,
    ]);
    expect(planExportDocuments(workbookSheets, reports)).toHaveLength(2);
  });

  it("describes every planned document for persistence and sharing", async () => {
    const { getExportDocuments, selectFile } = await loadWorkspace();
    expect(getExportDocuments()).toBeNull();

    await selectFile(workbook("lab-data.xlsx"));
    const documents = getExportDocuments();

    // Six test reports plus the Summary; the datasheets and the coral + org
    // worksheet are temporarily withheld, so they are never persisted either.
    expect(documents).toHaveLength(7);
    // The fixed-format test report is asset-backed and publishes no data.
    expect(documents[0]).toMatchObject({
      slug: "X-2026-522-1",
      assetPath: "./SampleDocuments/SampleOutput.pdf",
      data: null,
    });
    expect(documents.some((entry) => entry.slug === "X-2026-522-1-DS1")).toBe(false);
    expect(documents.some((entry) => entry.slug === "coral-org")).toBe(false);

    const summary = documents.find((entry) => entry.slug === "Summary");
    const summaryData = JSON.parse(summary.data);
    expect(summary.data.length).toBeLessThanOrEqual(100000);
    expect(summaryData.renderer).toBe("summary");
    expect(new Map(summaryData.cells).get("U10")).toBe("X-2026-522");
  });

  it("serialises and renders the withheld documents once they are re-enabled", async () => {
    const { getExportDocuments, selectFile, setDisabledDocumentKinds } = await loadWorkspace();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    setDisabledDocumentKinds([]);

    await selectFile(workbook("lab-data.xlsx"));
    const documents = getExportDocuments();
    expect(documents).toHaveLength(20);

    // Generated documents carry their worksheet grid as JSON, because
    // Firestore cannot store nested arrays.
    const datasheet = documents.find((entry) => entry.slug === "X-2026-522-1-DS1");
    expect(datasheet.assetPath).toBeNull();
    const sections = JSON.parse(datasheet.data);
    expect(sections[0].heading).toBe("DS1");
    expect(sections[0].rows.length).toBeGreaterThan(0);

    document.querySelector("#pdf-export").click();
    await vi.waitFor(() => expect(clickSpy).toHaveBeenCalledOnce());
    expect(clickSpy.mock.contexts[0].download).toBe("lab-data.zip");
    // All 20 are archived, in kind order: the Summary, the six reports (each
    // from the reference asset), then the twelve datasheets and the coral +
    // org worksheet, which the generic writer lays out landscape.
    const archived = (await downloadedArchiveEntries()).map((entry) => entry.name);
    expect(archived).toHaveLength(20);
    expect(archived).toContain("lab-data/lab-data-X-2026-522-1-DS1.pdf");
    expect(archived).toContain("lab-data/lab-data-coral-org.pdf");
    const markers = await downloadedDocumentMarkers();
    expect(markers.slice(0, 7)).toEqual([
      SUMMARY_MARKER,
      ...Array.from({ length: 6 }, () => ASSET_MARKER),
    ]);
    // The generated documents run to however many pages their grids need.
    expect(markers.slice(7).every((marker) => marker === GENERIC_MARKER)).toBe(true);
    expect(markers.length).toBeGreaterThan(7);
  });

  it("carries a dropped workbook through export and cloud save unattended", async () => {
    await loadWorkspace();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const cloudSave = document.querySelector("#cloud-save");
    const saveSpy = vi.fn();
    // The cloud-save controller is a separate ES module in the real page; the
    // workspace hands off by clicking this button, so that is what is asserted.
    cloudSave.addEventListener("click", saveSpy);
    const dropzone = document.querySelector("#dropzone");

    const drop = new Event("drop", { cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: { files: [workbook("auto.xlsx")] } });
    dropzone.dispatchEvent(drop);

    // One drop: parsed, exported, and handed to cloud save without a click.
    await vi.waitFor(() => expect(saveSpy).toHaveBeenCalledOnce());
    expect(clickSpy).toHaveBeenCalledOnce();
    expect(clickSpy.mock.contexts[0].download).toBe("auto.zip");
    expect(document.querySelector("#feedback").textContent).toContain("auto.zip");
  });

  it("stops the unattended workflow at whichever stage fails", async () => {
    await loadWorkspace();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const saveSpy = vi.fn();
    document.querySelector("#cloud-save").addEventListener("click", saveSpy);
    const dropzone = document.querySelector("#dropzone");

    const dropFile = (file) => {
      const drop = new Event("drop", { cancelable: true });
      Object.defineProperty(drop, "dataTransfer", { value: { files: [file] } });
      dropzone.dispatchEvent(drop);
    };

    // A file the workspace refuses never starts the pipeline at all.
    dropFile(workbook("notes.pdf"));
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(clickSpy).not.toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();

    // A workbook that parses to nothing stops before the export.
    stubReader({
      readWorkbook: () => ({ sheetNames: ["Summary"], cells: new Map(), reportGroups: [] }),
    });
    dropFile(workbook("empty.xlsx"));
    await vi.waitFor(() =>
      expect(document.querySelector("#pipeline-state").textContent).toBe("Failed"));
    expect(clickSpy).not.toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();

    // A workbook that parses but cannot produce a single document stops
    // before the cloud save, so nothing is persisted for an empty export.
    stubReader({
      readWorkbook: () => ({
        sheetNames: ["CV1", "TR1"],
        cells: new Map(),
        sheets: new Map([["CV1", new Map()], ["TR1", new Map()]]),
        reportGroups: [{ group: 1, sheets: { CV1: "CV1", TR1: "TR1" } }],
      }),
      extractReportIdentity: () => ({ job_ref: "X-1" }),
    });
    fetch.mockResolvedValue({ ok: false, status: 404 });
    dropFile(workbook("unbuildable.xlsx"));
    await vi.waitFor(() =>
      expect(document.querySelector("#feedback").textContent).toContain("Could not build"));
    expect(clickSpy).not.toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("orders the export: Summary first, then reports by sampling date", async () => {
    const { DOCUMENT_KINDS, exportOrder } = await loadWorkspace();
    const report = (slug, samplingDate) => ({
      slug,
      kind: DOCUMENT_KINDS.REPORT,
      samplingDate,
    });

    const ordered = exportOrder([
      report("june", "12/06/2026"),
      report("iso-april", "2026-04-09"),
      { slug: "Summary", kind: DOCUMENT_KINDS.SUMMARY },
      report("april", "08/04/2026"),
      report("may", "1/5/2026"),
    ]);

    // The Summary leads whatever its position in the workbook, and the reports
    // follow oldest first. A day-first date and an ISO one compare correctly
    // against each other, and single-digit days and months parse too.
    expect(ordered.map((entry) => entry.slug)).toEqual([
      "Summary",
      "april",
      "iso-april",
      "may",
      "june",
    ]);

    // Reports sharing a date -- the usual case -- keep the workbook's order,
    // and a report with no usable date sorts last rather than being guessed at.
    const sameDay = exportOrder([
      report("undated", ""),
      report("third", "08/04/2026"),
      report("unparsed", "April 8th"),
      report("first", "08/04/2026"),
      report("second", "08/04/2026"),
    ]);
    expect(sameDay.map((entry) => entry.slug)).toEqual([
      "third",
      "first",
      "second",
      "undated",
      "unparsed",
    ]);

    // Restoring the withheld kinds keeps them behind the reports.
    expect(exportOrder([
      { slug: "sheet", kind: DOCUMENT_KINDS.WORKSHEET },
      { slug: "ds", kind: DOCUMENT_KINDS.DATASHEET },
      report("report", "08/04/2026"),
    ]).map((entry) => entry.slug)).toEqual(["report", "ds", "sheet"]);
  });

  it("carries each report's sampling date onto its planned document", async () => {
    const { planExportDocuments, selectFile } = await loadMappedWorkspace();
    await selectFile(workbook("lab-data.xlsx"));

    const planned = planExportDocuments(
      { sheetNames: ["CV1", "TR1"] },
      [{ group: 1, job_ref: "X-1", sheets: { CV1: "CV1", TR1: "TR1" } }],
      new Map([[1, { cover: { samplingDate: "08/04/2026" } }]]),
    );
    expect(planned[0].samplingDate).toBe("08/04/2026");

    // A report with no mapped model is served from the reference asset and
    // carries no date of its own.
    const unmapped = planExportDocuments(
      { sheetNames: ["CV1", "TR1"] },
      [{ group: 1, job_ref: "X-1", sheets: { CV1: "CV1", TR1: "TR1" } }],
      new Map(),
    );
    expect(unmapped[0].samplingDate).toBe("");
  });

  it("keeps every report's slug unique when they share a job reference", async () => {
    const { planExportDocuments } = await loadWorkspace();

    // One job number covering several cargo holds is normal lab practice, and
    // the slug is the Firestore document id -- a collision silently overwrites
    // one report with another, so the wrong report is served to a recipient.
    const plan = planExportDocuments({ sheetNames: ["CV1", "TR1", "CV1 (2)", "TR1 (2)"] }, [
      { group: 1, job_ref: "X-2026-522", sheets: { CV1: "CV1", TR1: "TR1" } },
      { group: 2, job_ref: "X-2026-522", sheets: { CV1: "CV1 (2)", TR1: "TR1 (2)" } },
    ]);

    // The first keeps the clean job-reference name; later ones are
    // disambiguated by their group, and their datasheets follow suit.
    expect(plan.map((entry) => entry.slug)).toEqual(["X-2026-522", "X-2026-522-2"]);

    // A third hold sharing the reference, plus a worksheet whose own name
    // already slugifies onto a taken slug, still resolve to distinct ids.
    const crowded = planExportDocuments(
      { sheetNames: ["CV1", "TR1", "CV1 (2)", "TR1 (2)", "CV1 (3)", "TR1 (3)", "X-2026-522"] },
      [
        { group: 1, job_ref: "X-2026-522", sheets: { CV1: "CV1", TR1: "TR1" } },
        { group: 2, job_ref: "X-2026-522", sheets: { CV1: "CV1 (2)", TR1: "TR1 (2)" } },
        { group: 3, job_ref: "X-2026-522", sheets: { CV1: "CV1 (3)", TR1: "TR1 (3)" } },
      ],
    );
    const crowdedSlugs = crowded.map((entry) => entry.slug);
    expect(new Set(crowdedSlugs).size).toBe(crowdedSlugs.length);
    expect(crowdedSlugs.slice(0, 3)).toEqual(["X-2026-522", "X-2026-522-2", "X-2026-522-3"]);
  });

  it("disambiguates again when the first fallback slug is also taken", async () => {
    const { planExportDocuments, setDisabledDocumentKinds } = await loadWorkspace();
    setDisabledDocumentKinds([]);

    // A standalone worksheet can land on the very slug a repeated job
    // reference was already disambiguated into, so one pass is not always
    // enough: report group 2 takes "notes-2", and the worksheet sitting at
    // sheet index 1 would ask for that same name.
    const plan = planExportDocuments(
      { sheetNames: ["CV1", "notes", "TR1", "CV1 (2)", "TR1 (2)"] },
      [
        { group: 1, job_ref: "notes", sheets: { CV1: "CV1", TR1: "TR1" } },
        { group: 2, job_ref: "notes", sheets: { CV1: "CV1 (2)", TR1: "TR1 (2)" } },
      ],
    );

    const slugs = plan.map((entry) => entry.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs).toEqual(["notes", "notes-2", "notes-2-2"]);
  });

  it("keeps datasheet slugs unique when their report's slug repeats", async () => {
    const { planExportDocuments, setDisabledDocumentKinds } = await loadWorkspace();
    setDisabledDocumentKinds([]);

    const plan = planExportDocuments(
      { sheetNames: ["CV1", "TR1", "DS1", "CV1 (2)", "TR1 (2)", "DS1 (2)"] },
      [
        { group: 1, job_ref: "X-1", sheets: { CV1: "CV1", TR1: "TR1", DS1: "DS1" } },
        { group: 2, job_ref: "X-1", sheets: { CV1: "CV1 (2)", TR1: "TR1 (2)", DS1: "DS1 (2)" } },
      ],
    );

    const slugs = plan.map((entry) => entry.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs).toEqual(["X-1", "X-1-DS1", "X-1-2", "X-1-2-DS1"]);
  });

  it("plans around reports whose datasheets are missing", async () => {
    const { planExportDocuments } = await loadWorkspace();
    const plan = planExportDocuments({ sheetNames: ["CV1", "TR1"] }, [
      { group: 1, sheets: { CV1: "CV1", TR1: "TR1" } },
    ]);

    expect(plan).toHaveLength(1);
    expect(plan[0].slug).toBe("report-1");
    expect(plan[0].subtitle).toBe("");
  });

  it("titles datasheets by group number when the report has no job reference", async () => {
    const { planExportDocuments, setDisabledDocumentKinds } = await loadWorkspace();
    const workbookSheets = { sheetNames: ["CV1", "TR1", "DS1 "] };
    const reports = [{ group: 4, sheets: { CV1: "CV1", TR1: "TR1", DS1: "DS1 " } }];

    // The datasheet is planned but withheld while the restriction is on.
    expect(planExportDocuments(workbookSheets, reports).map((entry) => entry.slug)).toEqual([
      "report-4",
    ]);

    setDisabledDocumentKinds([]);
    const plan = planExportDocuments(workbookSheets, reports);
    expect(plan.map((entry) => entry.slug)).toEqual(["report-4", "report-4-DS1"]);
    expect(plan[1].title).toBe("DS1 Datasheet 4");
  });

  it("renders an empty document for a worksheet with no parsed cells", async () => {
    const { selectFile, setDisabledDocumentKinds } = await loadWorkspace();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    // Standalone worksheets are temporarily withheld; re-enable them so the
    // generic renderer's missing-sheet handling stays covered.
    setDisabledDocumentKinds([]);
    stubReader({
      readWorkbook: () => ({
        // The sheet is listed but absent from the per-sheet lookup.
        sheetNames: ["CV1", "TR1", "Ghost"],
        cells: new Map(),
        sheets: new Map([["CV1", new Map()], ["TR1", new Map()]]),
        reportGroups: [{ group: 1, sheets: { CV1: "CV1", TR1: "TR1" } }],
      }),
      extractReportIdentity: () => ({ job_ref: "X-1" }),
    });

    await selectFile(workbook("ghost.xlsx"));
    document.querySelector("#pdf-export").click();
    await vi.waitFor(() => expect(clickSpy).toHaveBeenCalledOnce());

    // The report leads, then the empty worksheet the generic writer produced.
    expect(await downloadedDocumentMarkers()).toEqual([ASSET_MARKER, GENERIC_MARKER]);
  });

  it("merges a generated document whichever byte container its renderer returns", async () => {
    const { selectFile, setDisabledDocumentKinds } = await loadWorkspace();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    setDisabledDocumentKinds([]);
    stubReader({
      readWorkbook: () => ({
        sheetNames: ["CV1", "TR1", "Notes"],
        cells: new Map(),
        sheets: new Map([["CV1", new Map()], ["TR1", new Map()], ["Notes", new Map()]]),
        reportGroups: [{ group: 1, sheets: { CV1: "CV1", TR1: "TR1" } }],
      }),
      extractReportIdentity: () => ({ job_ref: "X-1" }),
    });
    // The generic writer's documented return type is a Uint8Array, but the
    // merge step also accepts a plain ArrayBuffer -- pdf-lib's own save()
    // can return either depending on version, and neither should be coerced
    // through an unnecessary extra copy when it is already a Uint8Array.
    const NOTES_MARKER = 321;
    globalThis.docuAlignPdf = {
      createDocument: vi.fn(() => markerPdfBuffer(NOTES_MARKER)),
    };

    await selectFile(workbook("notes.xlsx"));
    document.querySelector("#pdf-export").click();
    await vi.waitFor(() => expect(clickSpy).toHaveBeenCalledOnce());

    expect(await downloadedDocumentMarkers()).toEqual([ASSET_MARKER, NOTES_MARKER]);
  });

  it("reports a fixed-format Summary generation failure without blocking other exports", async () => {
    const { getExportDocuments, selectFile } = await loadWorkspace();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    globalThis.docuAlignSummaryPdf.createDocument.mockRejectedValueOnce(
      new Error("Template unavailable"),
    );
    globalThis.docuAlignLogger = { logError: vi.fn() };
    stubReader({
      readWorkbook: () => ({
        sheetNames: ["CV1", "TR1", "Summary"],
        cells: new Map(),
        sheets: new Map([["CV1", new Map()], ["TR1", new Map()]]),
        reportGroups: [{ group: 1, sheets: { CV1: "CV1", TR1: "TR1" } }],
      }),
      extractReportIdentity: () => ({ job_ref: "X-1" }),
    });

    await selectFile(workbook("summary-error.xlsx"));
    const summary = getExportDocuments().find((document) => document.slug === "Summary");
    expect(JSON.parse(summary.data)).toEqual({ renderer: "summary", cells: [] });

    document.querySelector("#pdf-export").click();

    // The report is still worth having even though the Summary failed.
    await vi.waitFor(() =>
      expect(document.querySelector("#feedback").textContent).toBe(
        "Downloaded summary-error.zip with 1 document; could not generate Summary.",
      ),
    );
    expect(clickSpy).toHaveBeenCalledOnce();
    expect(await downloadedDocumentMarkers()).toEqual([ASSET_MARKER]);
    expect(globalThis.docuAlignLogger.logError).toHaveBeenCalledWith(
      "Summary PDF generation failed",
      expect.any(Error),
      expect.objectContaining({
        feature: "SummaryPdf",
        documentSlug: "Summary",
      }),
    );
  });

  it("still names a worksheet document when its title has no usable characters", async () => {
    const { DOCUMENT_KINDS, planExportDocuments, setDisabledDocumentKinds } = await loadWorkspace();

    // Withheld by default because it is a standalone worksheet.
    expect(planExportDocuments({ sheetNames: ["***"] }, [])).toEqual([]);

    setDisabledDocumentKinds([]);
    expect(planExportDocuments({ sheetNames: ["***"] }, [])).toEqual([
      {
        slug: "sheet",
        title: "***",
        subtitle: "",
        kind: DOCUMENT_KINDS.WORKSHEET,
        sheets: ["***"],
      },
    ]);
  });

  it("uses a fallback PDF name and applies the file runtime warning", async () => {
    const { applyRuntimeNotice, clearFile, reportBaseName, selectFile } = await loadWorkspace();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await selectFile(workbook("---.xlsx"));
    expect(reportBaseName()).toBe("report");
    document.querySelector("#pdf-export").click();
    await vi.waitFor(() => expect(clickSpy).toHaveBeenCalledOnce());
    expect(clickSpy.mock.contexts[0].download).toBe("report.zip");

    applyRuntimeNotice("https:");
    applyRuntimeNotice("file:");
    expect(document.querySelector("#google-sign-in").disabled).toBe(true);
    expect(document.querySelector("#auth-message").textContent).toContain("npm run dev");
    expect(document.querySelector("#auth-message").classList).toContain("is-error");
    clearFile();
  });

});
