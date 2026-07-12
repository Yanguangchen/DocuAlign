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

async function loadWorkspace() {
  await import("./workspace.js");
  return globalThis.docuAlignWorkspace;
}

describe("workspace controller", () => {
  beforeEach(() => {
    vi.resetModules();
    delete globalThis.docuAlignWorkspace;
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderWorkspace();
  });

  afterEach(() => {
    delete globalThis.docuAlignWorkspace;
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

  it("runs the visible ETL pipeline through completion", async () => {
    vi.useFakeTimers();
    const { selectFile } = await loadWorkspace();

    selectFile(workbook());
    expect(document.querySelector("#file-name").textContent).toBe("lab-data.xlsx");
    expect(document.querySelector("#file-meta").textContent).toBe("2.0 KB / Processing started");
    expect(document.querySelector("#pipeline-state").textContent).toBe("Processing");

    await vi.advanceTimersByTimeAsync(450);
    expect(document.querySelector("#pipeline-copy").textContent).toContain("Transforming");
    await vi.advanceTimersByTimeAsync(450);
    expect(document.querySelector("#pipeline-copy").textContent).toContain("Validating");
    await vi.advanceTimersByTimeAsync(450);

    expect(document.querySelector("#pipeline-state").textContent).toBe("Complete");
    expect(document.querySelector("#pipeline-step").classList).toContain("is-complete");
    expect(document.querySelector("#pdf-export").disabled).toBe(false);
    vi.useRealTimers();
  });

  it("clears active timers and resets the workspace", async () => {
    vi.useFakeTimers();
    const { clearFile, selectFile } = await loadWorkspace();
    const input = document.querySelector("#excel-file");

    selectFile(workbook());
    Object.defineProperty(input, "value", { value: "selected", writable: true });
    clearFile();
    await vi.runAllTimersAsync();

    expect(input.value).toBe("");
    expect(document.querySelector("#dropzone-prompt").hidden).toBe(false);
    expect(document.querySelector("#pipeline-state").textContent).toBe("Waiting");
    expect(document.querySelector("#cloud-save").disabled).toBe(true);
    vi.useRealTimers();
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
    expect(drop.defaultPrevented).toBe(true);
    expect(document.querySelector("#file-name").textContent).toBe("dropped.xlsx");
    clearFile();
  });

  it("blocks premature PDF export and downloads a sanitized report name", async () => {
    const { clearFile, selectFile } = await loadWorkspace();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const exportButton = document.querySelector("#pdf-export");

    exportButton.click();
    expect(document.querySelector("#feedback").textContent).toContain("before exporting");

    selectFile(workbook("Client Sample 01.xlsx"));
    exportButton.disabled = false;
    exportButton.click();
    const download = clickSpy.mock.contexts[0];
    expect(download.download).toBe("Client-Sample-01-final-report.pdf");
    expect(download.href).toContain("SampleDocuments/SampleOutput.pdf");
    expect(document.querySelector("#cloud-save").disabled).toBe(false);
    clearFile();
  });

  it("uses a fallback PDF name and applies the file runtime warning", async () => {
    const { applyRuntimeNotice, clearFile, selectFile } = await loadWorkspace();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    selectFile(workbook("---.xlsx"));
    document.querySelector("#pdf-export").disabled = false;
    document.querySelector("#pdf-export").click();
    expect(clickSpy.mock.contexts[0].download).toBe("report-final-report.pdf");

    applyRuntimeNotice("https:");
    applyRuntimeNotice("file:");
    expect(document.querySelector("#google-sign-in").disabled).toBe(true);
    expect(document.querySelector("#auth-message").textContent).toContain("npm run dev");
    expect(document.querySelector("#auth-message").classList).toContain("is-error");
    clearFile();
  });
});
