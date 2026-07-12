/**
 * @file workspace.js
 * @description Primary ETL workspace controller. Manages workbook selection,
 * drag/drop interaction, simulated pipeline progression, PDF export readiness,
 * and the direct-file authentication warning. This file intentionally remains
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

let pipelineTimers = [];
let selectedSourceName = "";

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
  pipelineTimers.forEach((timer) => clearTimeout(timer));
  pipelineTimers = [];
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

function startPipeline() {
  resetPipeline();
  pipelineStep.classList.add("is-active");
  pipelineState.textContent = "Processing";
  advancePipeline(0, "Extracting mapped report fields from the workbook.");

  pipelineTimers.push(setTimeout(() => {
    advancePipeline(1, "Transforming values into the report data model.");
  }, 450));
  pipelineTimers.push(setTimeout(() => {
    advancePipeline(2, "Validating the processed report data.");
  }, 900));
  pipelineTimers.push(setTimeout(() => {
    pipelineStages.forEach((stage) => {
      stage.classList.remove("is-active");
      stage.classList.add("is-complete");
    });
    pipelineStep.classList.add("is-complete");
    pipelineCopy.textContent = "Workbook processing is complete and ready for review.";
    pipelineState.textContent = "Complete";
    exportStep.classList.add("is-active");
    pdfExport.disabled = false;
    setFeedback("ETL complete. Review the processed data and export the final PDF.", true);
  }, 1350));
}

function clearFile() {
  input.value = "";
  selectedSourceName = "";
  prompt.hidden = false;
  selectedFile.hidden = true;
  dropzone.classList.remove("has-file");
  resetPipeline();
}

function selectFile(file) {
  if (!file) return;

  if (!isExcelFile(file)) {
    clearFile();
    setFeedback("Choose an Excel workbook in .xlsx or .xls format.", true);
    return;
  }

  prompt.hidden = true;
  selectedSourceName = file.name;
  selectedFile.hidden = false;
  dropzone.classList.add("has-file");
  fileName.textContent = file.name;
  fileMeta.textContent = `${formatFileSize(file.size)} / Processing started`;
  setFeedback("Workbook received. Running the ETL pipeline now.", true);
  startPipeline();
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

pdfExport.addEventListener("click", () => {
  if (!selectedSourceName) {
    setFeedback("Select and process a workbook before exporting the PDF.", true);
    return;
  }

  const reportName = selectedSourceName
    .replace(/\.(xlsx|xls)$/i, "")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "") || "report";
  const download = document.createElement("a");
  download.href = new URL("./SampleDocuments/SampleOutput.pdf", globalThis.location.href).href;
  download.download = `${reportName}-final-report.pdf`;
  download.rel = "noopener";
  document.body.appendChild(download);
  download.click();
  download.remove();

  exportStep.classList.add("is-complete");
  saveStep.classList.add("is-active");
  cloudSave.disabled = false;
  setFeedback("Final PDF download started. Cloud save is now available.", true);
});

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
  startPipeline,
});
