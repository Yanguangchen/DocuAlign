/**
 * @file workspace.js
 * @description Primary ETL workspace controller. Reads every worksheet from an
 * uploaded workbook, coordinates local processing state, generates the final
 * PDF, and handles the direct-file authentication warning. This file remains
 * classic-script compatible so the workspace keeps working over `file://`.
 */
const input = document.querySelector("#excel-file");
const dropzone = document.querySelector("#dropzone");
const prompt = document.querySelector("#dropzone-prompt");
const promptTitle = document.querySelector("#dropzone-title");
const selectedFile = document.querySelector("#selected-file");
const fileName = document.querySelector("#file-name");
const fileMeta = document.querySelector("#file-meta");
const feedback = document.querySelector("#feedback");
const pipelineStep = document.querySelector("#pipeline-step");
const pipelineCopy = document.querySelector("#pipeline-copy");
const pipelineState = document.querySelector("#pipeline-state");
const pipelineStages = [...document.querySelectorAll(".pipeline-stage")];
const exportStep = document.querySelector("#export-step");
const pdfExport = document.querySelector("#pdf-export");
const saveStep = document.querySelector("#save-step");
const cloudSave = document.querySelector("#cloud-save");
const defaultFeedback = "Select a workbook to begin the ETL pipeline.";

let selectedSourceName = "";
let processedWorkbook = null;
let pipelineRun = 0;

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isExcelFile(file) {
  const name = file.name.toLowerCase();
  return name.endsWith(".xlsx") || name.endsWith(".xls");
}

function setFeedback(message, emphasized) {
  feedback.textContent = message;
  feedback.classList.toggle("is-visible", emphasized);
}

function resetPipeline() {
  processedWorkbook = null;
  pipelineStep.classList.remove("is-active", "is-complete");
  exportStep.classList.remove("is-active", "is-complete");
  saveStep.classList.remove("is-active");
  pipelineStages.forEach((stage) => stage.classList.remove("is-active", "is-complete"));
  pipelineCopy.textContent = "Waiting for an Excel workbook.";
  pipelineState.textContent = "Waiting";
  pdfExport.disabled = true;
  cloudSave.disabled = true;
}

function advancePipeline(activeIndex, copy) {
  pipelineStages.forEach((stage, index) => {
    stage.classList.toggle("is-complete", index < activeIndex);
    stage.classList.toggle("is-active", index === activeIndex);
  });
  pipelineCopy.textContent = copy;
}

function failPipeline(message) {
  pipelineStages.forEach((stage) => stage.classList.remove("is-active", "is-complete"));
  pipelineStep.classList.remove("is-active", "is-complete");
  pipelineState.textContent = "Failed";
  pipelineCopy.textContent = message;
  pdfExport.disabled = true;
  setFeedback(message, true);
}

async function startPipeline(file) {
  resetPipeline();
  const currentRun = ++pipelineRun;
  pipelineStep.classList.add("is-active");
  pipelineState.textContent = "Processing";
  advancePipeline(0, "Reading every worksheet in the workbook.");

  try {
    const workbookPdf = globalThis.docuAlignWorkbookPdf;
    if (!workbookPdf) {
      throw new Error("Workbook processing is unavailable.");
    }

    const workbook = await workbookPdf.parseWorkbook(file);
    if (currentRun !== pipelineRun) return null;

    advancePipeline(1, `Preparing ${workbook.sheets.length} worksheets for PDF export.`);
    const validation = workbookPdf.validateWorkbook(workbook);
    advancePipeline(2, "Validating the parsed worksheet data.");

    if (!validation.isValid) {
      failPipeline("This workbook has no readable worksheets to export.");
      return null;
    }

    processedWorkbook = workbook;
    pipelineStages.forEach((stage) => {
      stage.classList.remove("is-active");
      stage.classList.add("is-complete");
    });
    pipelineStep.classList.add("is-complete");
    pipelineCopy.textContent =
      `${validation.sheetCount} worksheets were processed and are ready for export.`;
    pipelineState.textContent = "Complete";
    fileMeta.textContent =
      `${formatFileSize(file.size)} / ${validation.sheetCount} worksheets processed`;
    exportStep.classList.add("is-active");
    pdfExport.disabled = false;
    setFeedback(
      `ETL complete. The PDF will include all ${validation.sheetCount} workbook worksheets.`,
      true,
    );
    return workbook;
  } catch {
    if (currentRun !== pipelineRun) return null;
    failPipeline("The workbook could not be processed. Check the file and try again.");
    return null;
  }
}

function clearFile() {
  pipelineRun += 1;
  input.value = "";
  selectedSourceName = "";
  prompt.hidden = false;
  selectedFile.hidden = true;
  dropzone.classList.remove("has-file");
  resetPipeline();
}

async function selectFile(file) {
  if (!file) return null;

  if (!isExcelFile(file)) {
    clearFile();
    setFeedback("Choose an Excel workbook in .xlsx or .xls format.", true);
    return null;
  }

  prompt.hidden = true;
  selectedSourceName = file.name;
  selectedFile.hidden = false;
  dropzone.classList.add("has-file");
  fileName.textContent = file.name;
  fileMeta.textContent = `${formatFileSize(file.size)} / Processing started`;
  setFeedback("Workbook received. Running the ETL pipeline now.", true);
  return startPipeline(file);
}

function applyRuntimeNotice(protocol = globalThis.location.protocol) {
  if (protocol !== "file:") return;

  const signInButton = document.querySelector("#google-sign-in");
  signInButton.disabled = true;
  document.querySelector("#auth-message").textContent =
    "Open this app with npm run dev; Google authentication cannot run from file://.";
  document.querySelector("#auth-message").classList.add("is-error");
}

input.addEventListener("change", () => selectFile(input.files[0]));
document.querySelector("#replace-file").addEventListener("click", () => input.click());
document.querySelector("#remove-file").addEventListener("click", () => {
  clearFile();
  setFeedback(defaultFeedback, false);
});

function exportPdf() {
  if (!selectedSourceName || !processedWorkbook) {
    setFeedback("Select and process a workbook before exporting the PDF.", true);
    return;
  }

  try {
    const reportName = selectedSourceName
      .replace(/\.(xlsx|xls)$/i, "")
      .replace(/[^a-z0-9_-]+/gi, "-")
      .replace(/^-+|-+$/g, "") || "report";
    const pdfBlob = globalThis.docuAlignWorkbookPdf.createWorkbookPdf(processedWorkbook);
    const pdfUrl = globalThis.URL.createObjectURL(pdfBlob);
    const download = document.createElement("a");
    download.href = pdfUrl;
    download.download = `${reportName}-final-report.pdf`;
    download.rel = "noopener";
    document.body.appendChild(download);
    download.click();
    download.remove();
    setTimeout(() => globalThis.URL.revokeObjectURL(pdfUrl), 0);

    exportStep.classList.add("is-complete");
    saveStep.classList.add("is-active");
    cloudSave.disabled = false;
    setFeedback("Generated workbook PDF download started. Cloud save is now available.", true);
  } catch {
    setFeedback("The workbook PDF could not be generated. Check the file and try again.", true);
  }
}

pdfExport.addEventListener("click", exportPdf);

dropzone.addEventListener("dragenter", (event) => {
  event.preventDefault();
  dropzone.classList.add("is-dragging");
  promptTitle.textContent = "Release to add workbook";
});
dropzone.addEventListener("dragover", (event) => event.preventDefault());
dropzone.addEventListener("dragleave", (event) => {
  if (!dropzone.contains(event.relatedTarget)) {
    dropzone.classList.remove("is-dragging");
    promptTitle.textContent = "Drop your Excel workbook here";
  }
});
dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropzone.classList.remove("is-dragging");
  promptTitle.textContent = "Drop your Excel workbook here";
  selectFile(event.dataTransfer.files[0]);
});

applyRuntimeNotice();

// Exposed read-only for focused tests and support-console inspection. Runtime
// UI code continues to use the locally scoped functions above.
globalThis.docuAlignWorkspace = Object.freeze({
  advancePipeline,
  applyRuntimeNotice,
  clearFile,
  formatFileSize,
  isExcelFile,
  resetPipeline,
  selectFile,
  setFeedback,
  exportPdf,
  startPipeline,
});
