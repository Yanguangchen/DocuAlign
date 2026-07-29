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

function parsedWorkbook(sourceName = "lab-data.xlsx") {
  return {
    sourceName,
    sheets: [
      { name: "Cover", hidden: false, rows: [["Client", "Acme"]] },
      { name: "Results", hidden: false, rows: [["Moisture", "12.4"]] },
    ],
  };
}

function workbookApi(overrides = {}) {
  return {
    parseWorkbook: vi.fn(async (file) => parsedWorkbook(file.name)),
    ...overrides,
  };
}

function mappedReports(sourceName = "lab-data.xlsx") {
  return [
    { groupIndex: 1, jobRef: "JOB-1", sourceName, pageCount: 5 },
    { groupIndex: 2, jobRef: "JOB-2", sourceName, pageCount: 5 },
  ];
}

function mappingApi(overrides = {}) {
  return {
    buildMappedReports: vi.fn((parsed) => mappedReports(parsed.sourceName)),
    ...overrides,
  };
}

function rendererApi(overrides = {}) {
  return {
    createRakReportPdf: vi.fn(async () =>
      new Blob(["%PDF-generated"], { type: "application/pdf" })),
    ...overrides,
  };
}

function loggerApi() {
  return {
    logError: vi.fn(),
    logInfo: vi.fn(),
    logWarn: vi.fn(),
    trackOperation: vi.fn((_message, _context, operation) => operation()),
  };
}

async function loadWorkspace() {
  await import("./xlsx-reader.js");
  await import("./pdf-writer.js");
  await import("./workspace.js");
  return globalThis.docuAlignWorkspace;
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
<<<<<<< HEAD
    globalThis.docuAlignWorkbookPdf = workbookApi();
    globalThis.docuAlignReportMapping = mappingApi();
    globalThis.docuAlignRakReportPdf = rendererApi();
    globalThis.docuAlignLogger = loggerApi();
    globalThis.URL.createObjectURL = vi.fn(() => "blob:https://docualign.test/generated");
    globalThis.URL.revokeObjectURL = vi.fn();
=======
    delete globalThis.docuAlignXlsx;
    delete globalThis.docuAlignPdf;
    vi.stubGlobal("URL", Object.assign(globalThis.URL, {
      createObjectURL: vi.fn(() => "blob:generated"),
      revokeObjectURL: vi.fn(),
    }));
>>>>>>> 5d5b9f2 (Add behavioral tests for XLSX reader functionality)
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderWorkspace();
  });

  afterEach(() => {
    delete globalThis.docuAlignWorkspace;
<<<<<<< HEAD
    delete globalThis.docuAlignWorkbookPdf;
    delete globalThis.docuAlignReportMapping;
    delete globalThis.docuAlignRakReportPdf;
    delete globalThis.docuAlignLogger;
=======
    delete globalThis.docuAlignXlsx;
    delete globalThis.docuAlignPdf;
    vi.unstubAllGlobals();
>>>>>>> 5d5b9f2 (Add behavioral tests for XLSX reader functionality)
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

<<<<<<< HEAD
  it("maps every report group and runs the visible ETL pipeline through completion", async () => {
=======
  it("parses the real workbook and reports every detected test report", async () => {
>>>>>>> 5d5b9f2 (Add behavioral tests for XLSX reader functionality)
    const { selectFile } = await loadWorkspace();
    const file = workbook();

<<<<<<< HEAD
    const processing = selectFile(file);
=======
    const pipeline = selectFile(workbook("lab-data.xlsx", 2048));
>>>>>>> 5d5b9f2 (Add behavioral tests for XLSX reader functionality)
    expect(document.querySelector("#file-name").textContent).toBe("lab-data.xlsx");
    expect(document.querySelector("#file-meta").textContent).toBe("2.0 KB / Processing started");
    expect(document.querySelector("#pipeline-state").textContent).toBe("Processing");
    await pipeline;

<<<<<<< HEAD
    await processing;

    expect(globalThis.docuAlignWorkbookPdf.parseWorkbook).toHaveBeenCalledWith(file);
    expect(globalThis.docuAlignReportMapping.buildMappedReports).toHaveBeenCalledWith(
      parsedWorkbook(),
=======
    // SampleInput.xlsx holds six CV1/TR1/DS1/SB1 groups across 26 worksheets.
    expect(document.querySelector("#pipeline-copy").textContent).toBe(
      "Parsed 6 test reports from 26 worksheets.",
>>>>>>> 5d5b9f2 (Add behavioral tests for XLSX reader functionality)
    );
    expect(document.querySelector("#pipeline-state").textContent).toBe("Complete");
    expect(document.querySelector("#pipeline-copy").textContent).toContain("2 five-page reports");
    expect(document.querySelector("#file-meta").textContent).toContain("2 reports mapped");
    expect(document.querySelector("#pipeline-step").classList).toContain("is-complete");
    expect(document.querySelector("#pdf-export").disabled).toBe(false);
<<<<<<< HEAD
    expect(globalThis.docuAlignLogger.trackOperation).toHaveBeenCalledWith(
      "Process workbook locally",
      expect.objectContaining({
        feature: "WorkbookPipeline",
        function: "startPipeline",
        operation: "workbook.parseAndMap",
        category: "LocalProcessing",
        sourceExtension: "xlsx",
        sourceSizeBytes: 2048,
      }),
      expect.any(Function),
    );
    expect(globalThis.docuAlignLogger.logInfo).toHaveBeenCalledWith(
      "Workbook processing completed",
      expect.objectContaining({
        sheetCount: 2,
        reportCount: 2,
        outputPageCount: 10,
      }),
    );
    const [, operationContext] = globalThis.docuAlignLogger.trackOperation.mock.calls[0];
    expect(operationContext).not.toHaveProperty("sourceFileName");
    expect(operationContext).not.toHaveProperty("clientName");
  });

  it("invalidates in-flight parsing and resets the workspace", async () => {
    let finishParsing;
    globalThis.docuAlignWorkbookPdf.parseWorkbook = vi.fn(
      () => new Promise((resolve) => {
        finishParsing = resolve;
      }),
    );
    const { clearFile, selectFile } = await loadWorkspace();
    const input = document.querySelector("#excel-file");

    const processing = selectFile(workbook());
    Object.defineProperty(input, "value", { value: "selected", writable: true });
    clearFile();
    finishParsing(parsedWorkbook());
    await processing;
=======
    expect(document.querySelector("#feedback").textContent).toBe(
      "ETL complete. Export produces 20 separate PDFs.",
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
>>>>>>> 5d5b9f2 (Add behavioral tests for XLSX reader functionality)

    expect(input.value).toBe("");
    expect(document.querySelector("#dropzone-prompt").hidden).toBe(false);
    expect(document.querySelector("#pipeline-state").textContent).toBe("Waiting");
    expect(document.querySelector("#cloud-save").disabled).toBe(true);

<<<<<<< HEAD
    let rejectParsing;
    globalThis.docuAlignWorkbookPdf.parseWorkbook = vi.fn(
      () => new Promise((_, reject) => {
        rejectParsing = reject;
      }),
    );
    const rejectedProcessing = selectFile(workbook("replaced.xlsx"));
    clearFile();
    rejectParsing(new Error("stale parse failure"));
    await rejectedProcessing;
    expect(document.querySelector("#pipeline-state").textContent).toBe("Waiting");
=======
    // The export must re-lock once the parsed workbook is discarded; force the
    // button back on to prove the handler guards on state, not just the attribute.
    const exportButton = document.querySelector("#pdf-export");
    expect(exportButton.disabled).toBe(true);
    exportButton.disabled = false;
    exportButton.click();
    expect(document.querySelector("#feedback").textContent).toContain("before exporting");
>>>>>>> 5d5b9f2 (Add behavioral tests for XLSX reader functionality)
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
    await vi.waitFor(() => {
      expect(globalThis.docuAlignWorkbookPdf.parseWorkbook).toHaveBeenCalledWith(file);
    });
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
    await vi.waitFor(() => {
      expect(document.querySelector("#pipeline-state").textContent).toBe("Complete");
    });
    expect(drop.defaultPrevented).toBe(true);
    expect(document.querySelector("#file-name").textContent).toBe("dropped.xlsx");
    clearFile();
  });

<<<<<<< HEAD
  it("blocks premature PDF export and downloads the generated workbook PDF", async () => {
=======
  it("blocks premature export, then downloads a separate PDF for every document", async () => {
>>>>>>> 5d5b9f2 (Add behavioral tests for XLSX reader functionality)
    const { clearFile, selectFile } = await loadWorkspace();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const exportButton = document.querySelector("#pdf-export");

    exportButton.click();
    expect(document.querySelector("#feedback").textContent).toContain("before exporting");
    expect(clickSpy).not.toHaveBeenCalled();

    await selectFile(workbook("Client Sample 01.xlsx"));
<<<<<<< HEAD
    exportButton.click();
    await vi.waitFor(() => expect(clickSpy).toHaveBeenCalledOnce());
    const download = clickSpy.mock.contexts[0];
    expect(download.download).toBe("Client-Sample-01-final-report.pdf");
    expect(download.href).toBe("blob:https://docualign.test/generated");
    expect(globalThis.docuAlignRakReportPdf.createRakReportPdf).toHaveBeenCalledWith(
      mappedReports("Client Sample 01.xlsx"),
    );
    expect(globalThis.docuAlignLogger.trackOperation).toHaveBeenCalledWith(
      "Generate PDF from approved template",
      expect.objectContaining({
        feature: "PdfExport",
        function: "exportPdf",
        operation: "pdf.templateRender",
        reportCount: 2,
        outputPageCount: 10,
      }),
      expect.any(Function),
    );
    expect(globalThis.docuAlignLogger.logInfo).toHaveBeenCalledWith(
      "PDF export download prepared",
      expect.objectContaining({
        blobSizeBytes: expect.any(Number),
        mimeType: "application/pdf",
      }),
    );
    expect(globalThis.URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    await new Promise((resolve) => setTimeout(resolve));
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith(
      "blob:https://docualign.test/generated",
=======
    vi.useFakeTimers();
    exportButton.click();

    // Downloads are spaced out so the browser does not drop all but the first.
    expect(clickSpy).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(20 * 350);
    vi.useRealTimers();

    // Six reports + six DS1 + six SB1 datasheets + Summary + coral + org.
    expect(clickSpy).toHaveBeenCalledTimes(20);
    const names = clickSpy.mock.contexts.map((anchor) => anchor.download);
    expect(names.slice(0, 3)).toEqual([
      "Client-Sample-01-X-2026-522-1.pdf",
      "Client-Sample-01-X-2026-522-1-DS1.pdf",
      "Client-Sample-01-X-2026-522-1-SB1.pdf",
    ]);
    expect(names.slice(-2)).toEqual([
      "Client-Sample-01-Summary.pdf",
      "Client-Sample-01-coral-org.pdf",
    ]);
    // The six test reports keep their established layout and are served from
    // the reference asset; only the 14 supporting worksheets are generated.
    const hrefs = clickSpy.mock.contexts.map((anchor) => anchor.href);
    const reportHrefs = hrefs.filter((href) => href.includes("SampleOutput.pdf"));
    expect(reportHrefs).toHaveLength(6);
    expect(hrefs.filter((href) => href === "blob:generated")).toHaveLength(14);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(14);

    expect(document.querySelector("#feedback").textContent).toBe(
      "Started 20 separate PDFs -- allow multiple downloads if your browser asks. " +
        "Cloud save is now available.",
>>>>>>> 5d5b9f2 (Add behavioral tests for XLSX reader functionality)
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
    vi.advanceTimersByTime(350);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    vi.advanceTimersByTime(60000);
    vi.useRealTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:generated");
  });

  it("plans one document per report plus one per standalone worksheet", async () => {
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
    expect(plan.map((entry) => entry.slug)).toEqual(["X-1", "X-1-DS1", "X-1-SB1", "Summary"]);
    // The report keeps its established layout: served from the reference asset,
    // never re-rendered from the CV1/TR1 worksheet grids.
    expect(plan[0].assetPath).toBe("./SampleDocuments/SampleOutput.pdf");
    expect(plan[0].sheets).toEqual([]);
    // Its CV1 and TR1 sheets are claimed, so they never export on their own.
    expect(plan.some((entry) => entry.sheets.includes("CV1"))).toBe(false);
    expect(plan.some((entry) => entry.sheets.includes("TR1"))).toBe(false);
    expect(plan[1].sheets).toEqual(["DS1 "]);
    expect(plan[3].title).toBe("Summary");

    // A report without a job reference falls back to its group number.
    expect(reportIdentifier({ group: 3 })).toBe("report-3");
    expect(reportIdentifier({ group: 1, job_ref: "X/2026 522" })).toBe("X-2026-522");
  });

  it("describes every planned document for persistence and sharing", async () => {
    const { getExportDocuments, selectFile } = await loadWorkspace();
    expect(getExportDocuments()).toBeNull();

    await selectFile(workbook("lab-data.xlsx"));
    const documents = getExportDocuments();

    expect(documents).toHaveLength(20);
    // The fixed-format test report is asset-backed and publishes no data.
    expect(documents[0]).toMatchObject({
      slug: "X-2026-522-1",
      assetPath: "./SampleDocuments/SampleOutput.pdf",
      data: null,
    });

    // Generated documents carry their worksheet grid as JSON, because
    // Firestore cannot store nested arrays.
    const datasheet = documents.find((entry) => entry.slug === "X-2026-522-1-DS1");
    expect(datasheet.assetPath).toBeNull();
    const sections = JSON.parse(datasheet.data);
    expect(sections[0].heading).toBe("DS1");
    expect(sections[0].rows.length).toBeGreaterThan(0);
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
    const { planExportDocuments } = await loadWorkspace();
    const plan = planExportDocuments({ sheetNames: ["CV1", "TR1", "DS1 "] }, [
      { group: 4, sheets: { CV1: "CV1", TR1: "TR1", DS1: "DS1 " } },
    ]);

    expect(plan.map((entry) => entry.slug)).toEqual(["report-4", "report-4-DS1"]);
    expect(plan[1].title).toBe("DS1 Datasheet 4");
  });

  it("renders an empty document for a worksheet with no parsed cells", async () => {
    const { selectFile } = await loadWorkspace();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
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

  it("still names a worksheet document when its title has no usable characters", async () => {
    const { planExportDocuments } = await loadWorkspace();
    const plan = planExportDocuments({ sheetNames: ["***"] }, []);

    expect(plan).toEqual([{ slug: "sheet", title: "***", subtitle: "", sheets: ["***"] }]);
  });

  it("cancels pending downloads when the workspace is reset mid-export", async () => {
    const { clearFile, selectFile } = await loadWorkspace();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

<<<<<<< HEAD
    await selectFile(workbook("---.xlsx"));
    document.querySelector("#pdf-export").click();
    await vi.waitFor(() => expect(clickSpy).toHaveBeenCalledOnce());
    expect(clickSpy.mock.contexts[0].download).toBe("report-final-report.pdf");
=======
    await selectFile(workbook("lab-data.xlsx"));
    vi.useFakeTimers();
    document.querySelector("#pdf-export").click();
    vi.advanceTimersByTime(350);
    expect(clickSpy).toHaveBeenCalledTimes(2);

    clearFile();
    vi.advanceTimersByTime(10 * 350);
    vi.useRealTimers();

    // The four still-queued downloads must not fire after the reset.
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

    // A second click discards the queued downloads and re-queues all 20.
    exportButton.click();
    vi.advanceTimersByTime(25 * 350);
    vi.useRealTimers();

    expect(clickSpy).toHaveBeenCalledTimes(22);
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
>>>>>>> 5d5b9f2 (Add behavioral tests for XLSX reader functionality)

    applyRuntimeNotice("https:");
    applyRuntimeNotice("file:");
    expect(document.querySelector("#google-sign-in").disabled).toBe(true);
    expect(document.querySelector("#auth-message").textContent).toContain("npm run dev");
    expect(document.querySelector("#auth-message").classList).toContain("is-error");
    clearFile();
  });

  it("keeps export disabled when workbook parsing or semantic mapping fails", async () => {
    globalThis.docuAlignWorkbookPdf.parseWorkbook = vi
      .fn()
      .mockRejectedValueOnce(new Error("corrupt workbook"));
    const { selectFile } = await loadWorkspace();

    await selectFile(workbook("corrupt.xlsx"));

    expect(document.querySelector("#pipeline-state").textContent).toBe("Failed");
    expect(document.querySelector("#feedback").textContent).toContain("could not be processed");
    expect(document.querySelector("#pdf-export").disabled).toBe(true);

    globalThis.docuAlignWorkbookPdf.parseWorkbook.mockResolvedValueOnce({ sheets: [] });
    globalThis.docuAlignReportMapping.buildMappedReports.mockReturnValueOnce([]);
    await selectFile(workbook("empty.xlsx"));
    expect(document.querySelector("#feedback").textContent).toContain("no complete report groups");
    expect(document.querySelector("#pdf-export").disabled).toBe(true);

    delete globalThis.docuAlignWorkbookPdf;
    await selectFile(workbook("runtime-missing.xlsx"));
    expect(document.querySelector("#feedback").textContent).toContain("could not be processed");
  });

  it("recovers when PDF generation fails", async () => {
    const { selectFile } = await loadWorkspace();
    await selectFile(workbook());
    globalThis.docuAlignRakReportPdf.createRakReportPdf.mockRejectedValueOnce(
      new Error("PDF rendering failed"),
    );

    document.querySelector("#pdf-export").click();

    await vi.waitFor(() => {
      expect(document.querySelector("#feedback").textContent).toContain(
        "could not be generated",
      );
    });
    expect(document.querySelector("#cloud-save").disabled).toBe(true);
  });

  it("continues local processing when the structured logger bridge is unavailable", async () => {
    delete globalThis.docuAlignLogger;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const { exportPdf, selectFile } = await loadWorkspace();

    await selectFile(workbook());
    await exportPdf();

    expect(document.querySelector("#pipeline-state").textContent).toBe("Complete");
    expect(globalThis.URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
  });
});
