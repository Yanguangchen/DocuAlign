/**
 * @file workspace.test.js
 * @description Behavioral coverage for the primary workspace controller,
 * including file selection, real workbook parsing, drag/drop, the two-document
 * PDF export, and the direct-file runtime notice.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const workbookBytes = readFileSync(resolve(".", "SampleDocuments/SampleInput.xlsx"));

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

async function loadWorkspace() {
  await import("./xlsx-reader.js");
  await import("./pdf-writer.js");
  await import("./summary-pdf.js");
  globalThis.docuAlignSummaryPdf = {
    createDocument: vi.fn(async () => new Uint8Array([37, 80, 68, 70])),
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
    createRakReportPdf: vi.fn(async () => new Blob([new Uint8Array([37, 80, 68, 70])], {
      type: "application/pdf",
    })),
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
    vi.stubGlobal("URL", Object.assign(globalThis.URL, {
      createObjectURL: vi.fn(() => "blob:generated"),
      revokeObjectURL: vi.fn(),
    }));
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

    vi.useFakeTimers();
    document.querySelector("#pdf-export").click();
    vi.advanceTimersByTime(350);
    vi.useRealTimers();

    expect(clickSpy).toHaveBeenCalledOnce();
    expect(document.querySelector("#feedback").textContent).toBe(
      "Started 1 separate PDF. Cloud save is now available.",
    );
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
    const input = document.querySelector("#excel-file");
    const dropzone = document.querySelector("#dropzone");
    const file = workbook("drop.xls");
    Object.defineProperty(input, "files", { value: [file] });
    input.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(document.querySelector("#pipeline-state").textContent).toBe("Complete"));
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
    await vi.waitFor(() => expect(document.querySelector("#pipeline-state").textContent).toBe("Complete"));
    expect(drop.defaultPrevented).toBe(true);
    expect(document.querySelector("#file-name").textContent).toBe("dropped.xlsx");
    clearFile();
  });

  it("blocks premature export, then downloads a separate PDF for every document", async () => {
    const { clearFile, selectFile } = await loadWorkspace();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const exportButton = document.querySelector("#pdf-export");

    exportButton.click();
    expect(document.querySelector("#feedback").textContent).toContain("before exporting");
    expect(clickSpy).not.toHaveBeenCalled();

    await selectFile(workbook("Client Sample 01.xlsx"));
    vi.useFakeTimers();
    exportButton.click();

    // Downloads are spaced out so the browser does not drop all but the first.
    expect(clickSpy).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(7 * 350);
    vi.useRealTimers();
    await vi.waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(7));

    // Six reports + the Summary. The DS1/SB1 datasheets and the coral + org
    // worksheet are temporarily withheld from the export.
    expect(globalThis.docuAlignSummaryPdf.createDocument).toHaveBeenCalledOnce();
    const names = clickSpy.mock.contexts.map((anchor) => anchor.download);
    expect(names.slice(0, 3)).toEqual([
      "Client-Sample-01-X-2026-522-1.pdf",
      "Client-Sample-01-X-2026-522-2.pdf",
      "Client-Sample-01-X-2026-522-3.pdf",
    ]);
    expect(names).toContain("Client-Sample-01-Summary.pdf");
    expect(names.some((name) => /-DS1\.pdf$|-SB1\.pdf$/.test(name))).toBe(false);
    expect(names).not.toContain("Client-Sample-01-coral-org.pdf");
    // The six test reports keep their established layout and are served from
    // the reference asset; only the Summary is generated right now.
    const hrefs = clickSpy.mock.contexts.map((anchor) => anchor.href);
    const reportHrefs = hrefs.filter((href) => href.includes("SampleOutput.pdf"));
    expect(reportHrefs).toHaveLength(6);
    expect(hrefs.filter((href) => href === "blob:generated")).toHaveLength(1);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);

    expect(document.querySelector("#feedback").textContent).toBe(
      "Started 7 separate PDFs -- allow multiple downloads if your browser asks. " +
        "Cloud save is now available.",
    );
    expect(document.querySelector("#cloud-save").disabled).toBe(false);
    clearFile();
  });

  it("releases each generated document's object URL", async () => {
    const { selectFile } = await loadWorkspace();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await selectFile(workbook("lab-data.xlsx"));
    vi.useFakeTimers();
    document.querySelector("#pdf-export").click();
    // The generated Summary is queued last, after the six asset-backed reports.
    await vi.advanceTimersByTimeAsync(7 * 350);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60000);
    vi.useRealTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:generated");
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

    vi.useFakeTimers();
    document.querySelector("#pdf-export").click();
    vi.advanceTimersByTime(7 * 350);
    vi.useRealTimers();
    await vi.waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(7));

    // Every report is generated now, so no download points at the static asset.
    const hrefs = clickSpy.mock.contexts.map((anchor) => anchor.href);
    expect(hrefs.filter((href) => href.includes("SampleOutput.pdf"))).toHaveLength(0);
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

    vi.useFakeTimers();
    document.querySelector("#pdf-export").click();
    vi.advanceTimersByTime(350);
    vi.useRealTimers();
    expect(clickSpy.mock.contexts[0].href).toContain("SampleOutput.pdf");
    expect(globalThis.docuAlignRakReportPdf.createRakReportPdf).not.toHaveBeenCalled();
  });

  it("reports a test report generation failure without blocking other exports", async () => {
    const { selectFile } = await loadMappedWorkspace();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    globalThis.docuAlignRakReportPdf.createRakReportPdf.mockRejectedValueOnce(
      new Error("Template unavailable"),
    );
    globalThis.docuAlignLogger = { logError: vi.fn() };

    await selectFile(workbook("lab-data.xlsx"));
    vi.useFakeTimers();
    document.querySelector("#pdf-export").click();
    vi.advanceTimersByTime(7 * 350);
    vi.useRealTimers();

    await vi.waitFor(() =>
      expect(document.querySelector("#feedback").textContent).toBe(
        "Could not generate Test Report X-2026-522-1. Try exporting again.",
      ),
    );
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

    vi.useFakeTimers();
    document.querySelector("#pdf-export").click();
    vi.advanceTimersByTime(20 * 350);
    vi.useRealTimers();
    await vi.waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(20));
    const names = clickSpy.mock.contexts.map((anchor) => anchor.download);
    expect(names).toContain("lab-data-X-2026-522-1-DS1.pdf");
    expect(names).toContain("lab-data-coral-org.pdf");
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
    vi.useFakeTimers();
    document.querySelector("#pdf-export").click();
    vi.advanceTimersByTime(2 * 350);
    vi.useRealTimers();

    expect(clickSpy.mock.contexts.map((anchor) => anchor.download)).toEqual([
      "ghost-X-1.pdf",
      "ghost-Ghost.pdf",
    ]);
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

    vi.useFakeTimers();
    document.querySelector("#pdf-export").click();
    vi.advanceTimersByTime(2 * 350);
    vi.useRealTimers();

    await vi.waitFor(() =>
      expect(document.querySelector("#feedback").textContent).toBe(
        "Could not generate Summary. Try exporting again.",
      ),
    );
    expect(clickSpy).toHaveBeenCalledOnce();
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

  it("cancels pending downloads when the workspace is reset mid-export", async () => {
    const { clearFile, selectFile } = await loadWorkspace();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await selectFile(workbook("lab-data.xlsx"));
    vi.useFakeTimers();
    document.querySelector("#pdf-export").click();
    vi.advanceTimersByTime(350);
    expect(clickSpy).toHaveBeenCalledTimes(2);

    clearFile();
    vi.advanceTimersByTime(10 * 350);
    vi.useRealTimers();

    // The five still-queued downloads must not fire after the reset.
    expect(clickSpy).toHaveBeenCalledTimes(2);
  });

  it("restarts the queue instead of doubling it when export is clicked twice", async () => {
    const { selectFile } = await loadWorkspace();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const exportButton = document.querySelector("#pdf-export");

    await selectFile(workbook("lab-data.xlsx"));
    vi.useFakeTimers();
    exportButton.click();
    vi.advanceTimersByTime(350);
    expect(clickSpy).toHaveBeenCalledTimes(2);

    // A second click discards the queued downloads and re-queues all 7.
    exportButton.click();
    vi.advanceTimersByTime(10 * 350);
    vi.useRealTimers();

    await vi.waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(9));
  });

  it("uses a fallback PDF name and applies the file runtime warning", async () => {
    const { applyRuntimeNotice, clearFile, reportBaseName, selectFile } = await loadWorkspace();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await selectFile(workbook("---.xlsx"));
    expect(reportBaseName()).toBe("report");
    vi.useFakeTimers();
    document.querySelector("#pdf-export").click();
    vi.advanceTimersByTime(350);
    vi.useRealTimers();
    expect(clickSpy.mock.contexts[0].download).toBe("report-X-2026-522-1.pdf");

    applyRuntimeNotice("https:");
    applyRuntimeNotice("file:");
    expect(document.querySelector("#google-sign-in").disabled).toBe(true);
    expect(document.querySelector("#auth-message").textContent).toContain("npm run dev");
    expect(document.querySelector("#auth-message").classList).toContain("is-error");
    clearFile();
  });

});
