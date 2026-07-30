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
    vi.advanceTimersByTime(20 * 350);
    vi.useRealTimers();
    await vi.waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(20));

    // Six reports + six DS1 + six SB1 datasheets + Summary + coral + org.
    expect(globalThis.docuAlignSummaryPdf.createDocument).toHaveBeenCalledOnce();
    const names = clickSpy.mock.contexts.map((anchor) => anchor.download);
    expect(names.slice(0, 3)).toEqual([
      "Client-Sample-01-X-2026-522-1.pdf",
      "Client-Sample-01-X-2026-522-1-DS1.pdf",
      "Client-Sample-01-X-2026-522-1-SB1.pdf",
    ]);
    // Summary rendering is asynchronous because it overlays the approved
    // template, so its click may settle just after the following generic sheet.
    expect(names.slice(-2)).toEqual(expect.arrayContaining([
      "Client-Sample-01-Summary.pdf",
      "Client-Sample-01-coral-org.pdf",
    ]));
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
    expect(plan[3].renderer).toBe("summary");

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

    const summary = documents.find((entry) => entry.slug === "Summary");
    const summaryData = JSON.parse(summary.data);
    expect(summary.data.length).toBeLessThanOrEqual(100000);
    expect(summaryData.renderer).toBe("summary");
    expect(new Map(summaryData.cells).get("U10")).toBe("X-2026-522");
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
    const { planExportDocuments } = await loadWorkspace();
    const plan = planExportDocuments({ sheetNames: ["***"] }, []);

    expect(plan).toEqual([{ slug: "sheet", title: "***", subtitle: "", sheets: ["***"] }]);
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

    await vi.waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(22));
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
