/**
 * @file workspace.test.js
 * @description Behavioral coverage for the primary workspace controller,
 * including file selection, pipeline progression, drag/drop, PDF export, and
 * the direct-file runtime notice.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

function workbook(name = "lab-data.xlsx", size = 2048) {
  const file = new File(["data"], name);
  Object.defineProperty(file, "size", { value: size });
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
    validateWorkbook: vi.fn((parsed) => ({
      isValid: parsed.sheets.length > 0,
      sheetCount: parsed.sheets.length,
    })),
    createWorkbookPdf: vi.fn(() => new Blob(["%PDF-generated"], { type: "application/pdf" })),
    ...overrides,
  };
}

async function loadWorkspace() {
  await import("./workspace.js");
  return globalThis.docuAlignWorkspace;
}

describe("workspace controller", () => {
  beforeEach(() => {
    vi.resetModules();
    delete globalThis.docuAlignWorkspace;
    globalThis.docuAlignWorkbookPdf = workbookApi();
    globalThis.URL.createObjectURL = vi.fn(() => "blob:https://docualign.test/generated");
    globalThis.URL.revokeObjectURL = vi.fn();
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderWorkspace();
  });

  afterEach(() => {
    delete globalThis.docuAlignWorkspace;
    delete globalThis.docuAlignWorkbookPdf;
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

    selectFile(null);
    selectFile(workbook("report.pdf"));

    expect(document.querySelector("#feedback").textContent).toContain("Choose an Excel workbook");
    expect(document.querySelector("#feedback").classList).toContain("is-visible");
    expect(document.querySelector("#selected-file").hidden).toBe(true);
    expect(document.querySelector("#pdf-export").disabled).toBe(true);
  });

  it("parses every worksheet and runs the visible ETL pipeline through completion", async () => {
    const { selectFile } = await loadWorkspace();
    const file = workbook();

    const processing = selectFile(file);
    expect(document.querySelector("#file-name").textContent).toBe("lab-data.xlsx");
    expect(document.querySelector("#file-meta").textContent).toBe("2.0 KB / Processing started");
    expect(document.querySelector("#pipeline-state").textContent).toBe("Processing");

    await processing;

    expect(globalThis.docuAlignWorkbookPdf.parseWorkbook).toHaveBeenCalledWith(file);
    expect(globalThis.docuAlignWorkbookPdf.validateWorkbook).toHaveBeenCalledWith(
      parsedWorkbook(),
    );
    expect(document.querySelector("#pipeline-state").textContent).toBe("Complete");
    expect(document.querySelector("#pipeline-copy").textContent).toContain("2 worksheets");
    expect(document.querySelector("#file-meta").textContent).toContain("2 worksheets processed");
    expect(document.querySelector("#pipeline-step").classList).toContain("is-complete");
    expect(document.querySelector("#pdf-export").disabled).toBe(false);
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

    expect(input.value).toBe("");
    expect(document.querySelector("#dropzone-prompt").hidden).toBe(false);
    expect(document.querySelector("#pipeline-state").textContent).toBe("Waiting");
    expect(document.querySelector("#cloud-save").disabled).toBe(true);

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
    Object.defineProperty(childLeave, "relatedTarget", { value: document.querySelector("#dropzone-title") });
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

  it("blocks premature PDF export and downloads the generated workbook PDF", async () => {
    const { clearFile, selectFile } = await loadWorkspace();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const exportButton = document.querySelector("#pdf-export");

    exportButton.click();
    expect(document.querySelector("#feedback").textContent).toContain("before exporting");

    await selectFile(workbook("Client Sample 01.xlsx"));
    exportButton.click();
    const download = clickSpy.mock.contexts[0];
    expect(download.download).toBe("Client-Sample-01-final-report.pdf");
    expect(download.href).toBe("blob:https://docualign.test/generated");
    expect(globalThis.docuAlignWorkbookPdf.createWorkbookPdf).toHaveBeenCalledWith(
      parsedWorkbook("Client Sample 01.xlsx"),
    );
    expect(globalThis.URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    await new Promise((resolve) => setTimeout(resolve));
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith(
      "blob:https://docualign.test/generated",
    );
    expect(document.querySelector("#cloud-save").disabled).toBe(false);
    clearFile();
  });

  it("uses a fallback PDF name and applies the file runtime warning", async () => {
    const { applyRuntimeNotice, clearFile, selectFile } = await loadWorkspace();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await selectFile(workbook("---.xlsx"));
    document.querySelector("#pdf-export").click();
    expect(clickSpy.mock.contexts[0].download).toBe("report-final-report.pdf");

    applyRuntimeNotice("https:");
    applyRuntimeNotice("file:");
    expect(document.querySelector("#google-sign-in").disabled).toBe(true);
    expect(document.querySelector("#auth-message").textContent).toContain("npm run dev");
    expect(document.querySelector("#auth-message").classList).toContain("is-error");
    clearFile();
  });

  it("keeps export disabled when workbook parsing or validation fails", async () => {
    globalThis.docuAlignWorkbookPdf.parseWorkbook = vi
      .fn()
      .mockRejectedValueOnce(new Error("corrupt workbook"));
    const { selectFile } = await loadWorkspace();

    await selectFile(workbook("corrupt.xlsx"));

    expect(document.querySelector("#pipeline-state").textContent).toBe("Failed");
    expect(document.querySelector("#feedback").textContent).toContain("could not be processed");
    expect(document.querySelector("#pdf-export").disabled).toBe(true);

    globalThis.docuAlignWorkbookPdf.parseWorkbook.mockResolvedValueOnce({ sheets: [] });
    await selectFile(workbook("empty.xlsx"));
    expect(document.querySelector("#feedback").textContent).toContain("no readable worksheets");
    expect(document.querySelector("#pdf-export").disabled).toBe(true);

    delete globalThis.docuAlignWorkbookPdf;
    await selectFile(workbook("runtime-missing.xlsx"));
    expect(document.querySelector("#feedback").textContent).toContain("could not be processed");
  });

  it("recovers when PDF generation fails", async () => {
    const { selectFile } = await loadWorkspace();
    await selectFile(workbook());
    globalThis.docuAlignWorkbookPdf.createWorkbookPdf.mockImplementation(() => {
      throw new Error("PDF rendering failed");
    });

    document.querySelector("#pdf-export").click();

    expect(document.querySelector("#feedback").textContent).toContain("could not be generated");
    expect(document.querySelector("#cloud-save").disabled).toBe(true);
  });
});
