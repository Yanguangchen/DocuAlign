/**
 * @file workspace.js
 * @description Primary ETL workspace controller. Manages workbook selection,
 * drag/drop interaction, real workbook parsing via `src/xlsx-reader.js`, PDF
 * export readiness, and the direct-file authentication warning. This file
 * intentionally remains classic-script compatible so the workspace keeps
 * working over `file://`.
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

/**
 * The test report document (`CV1` cover + `TR1` results) keeps the established
 * RAK report layout and is served from the static reference asset. It is
 * deliberately NOT generated from worksheet data -- the report format must not
 * change. Only the supporting worksheets are rendered by `src/pdf-writer.js`.
 */
const REPORT_ASSET_PATH = "./SampleDocuments/SampleOutput.pdf";

/**
 * The kind of document a planned export represents. Every planned document
 * carries one so export coverage can be narrowed without removing any of the
 * planning or rendering code behind it.
 */
const DOCUMENT_KINDS = Object.freeze({
  REPORT: "report",
  DATASHEET: "datasheet",
  SUMMARY: "summary",
  WORKSHEET: "worksheet",
});

/**
 * TEMPORARY EXPORT RESTRICTION.
 *
 * Exporting is currently limited to the fixed-format `CV1` + `TR1` test report
 * and the `Summary` document. The `DS1`/`SB1` datasheets and the remaining
 * standalone worksheets (`coral + org`, …) are still planned, rendered, and
 * serialised by the code below -- they are only withheld from the export plan
 * by this list. Nothing supporting them has been deleted: call
 * `setDisabledDocumentKinds([])` (or empty this list) to restore the full
 * document export.
 */
const TEMPORARILY_DISABLED_DOCUMENT_KINDS = Object.freeze([
  DOCUMENT_KINDS.DATASHEET,
  DOCUMENT_KINDS.WORKSHEET,
]);

let disabledDocumentKinds = TEMPORARILY_DISABLED_DOCUMENT_KINDS;

/**
 * Choose which document kinds are withheld from the export.
 * @param {string[]} [kinds] - Kinds to withhold. Defaults back to the
 * temporary restriction; pass `[]` to export every planned document again.
 * @returns {string[]} The kinds now withheld.
 */
function setDisabledDocumentKinds(kinds = TEMPORARILY_DISABLED_DOCUMENT_KINDS) {
  disabledDocumentKinds = Object.freeze([...kinds]);
  return disabledDocumentKinds;
}

/**
 * Decide whether a planned document is currently exportable.
 * @param {{kind: string}} plan - Planned document.
 * @returns {boolean} True when the document's kind is not withheld.
 */
function isDocumentEnabled(plan) {
  return !disabledDocumentKinds.includes(plan.kind);
}

/**
 * Gap between document downloads. Browsers throttle multiple programmatic
 * downloads triggered in one synchronous burst -- Chrome in particular keeps
 * only the first -- so the anchors are spaced out instead of fired in a loop.
 */
const DOWNLOAD_INTERVAL_MS = 350;

/** Grace period before a download's object URL is released. */
const REVOKE_DELAY_MS = 60000;

let selectedSourceName = "";
let parsedDocuments = null;
let parsedSheets = new Map();
let downloadTimers = [];

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
  parsedDocuments = null;
  parsedSheets = new Map();
  downloadTimers.forEach((timer) => clearTimeout(timer));
  downloadTimers = [];
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

/**
 * Mark the pipeline as failed and keep the export locked.
 * @param {Error} error - The failure raised while reading the workbook.
 * @returns {void}
 */
function failPipeline(error) {
  pipelineStages.forEach((stage) => stage.classList.remove("is-active", "is-complete"));
  pipelineStep.classList.remove("is-active");
  pipelineState.textContent = "Failed";
  pipelineCopy.textContent = error.message;
  pdfExport.disabled = true;
  setFeedback(`Could not process this workbook. ${error.message}`, true);
}

/**
 * Run the extract/transform/validate pipeline against a real workbook.
 * @param {File} file - The selected Excel workbook.
 * @returns {Promise<void>} Resolves once the pipeline settles.
 */
async function startPipeline(file) {
  resetPipeline();
  pipelineStep.classList.add("is-active");
  pipelineState.textContent = "Processing";
  advancePipeline(0, "Extracting mapped report fields from the workbook.");

  try {
    const reader = globalThis.docuAlignXlsx;
    const workbook = await reader.readWorkbook(file);

    advancePipeline(1, "Transforming values into the report data model.");
    const reports = workbook.reportGroups.map((reportGroup) =>
      Object.assign(
        { group: reportGroup.group, sheets: reportGroup.sheets },
        reader.extractReportIdentity(workbook.cells, reportGroup),
      ),
    );

    advancePipeline(2, "Validating the processed report data.");
    if (reports.length === 0) {
      throw new Error("No complete CV1/TR1/DS1/SB1 test report sheet groups were found.");
    }

    parsedSheets = workbook.sheets;
    parsedDocuments = planExportDocuments(workbook, reports);
    pipelineStages.forEach((stage) => {
      stage.classList.remove("is-active");
      stage.classList.add("is-complete");
    });
    pipelineStep.classList.add("is-complete");
    pipelineCopy.textContent = `Parsed ${reports.length} test ${
      reports.length === 1 ? "report" : "reports"
    } from ${workbook.sheetNames.length} worksheets.`;
    pipelineState.textContent = "Complete";
    exportStep.classList.add("is-active");
    pdfExport.disabled = false;
    setFeedback(
      `ETL complete. Export produces ${parsedDocuments.length} separate ${
        parsedDocuments.length === 1 ? "PDF" : "PDFs"
      }.`,
      true,
    );
  } catch (error) {
    failPipeline(error);
  }
}

function clearFile() {
  input.value = "";
  selectedSourceName = "";
  prompt.hidden = false;
  selectedFile.hidden = true;
  dropzone.classList.remove("has-file");
  resetPipeline();
}

/**
 * Validate and accept a dropped or chosen workbook, then run the pipeline.
 * @param {File} file - Candidate workbook.
 * @returns {Promise<void>|undefined} The in-flight pipeline, for callers that await it.
 */
function selectFile(file) {
  if (!file) return undefined;

  if (!isExcelFile(file)) {
    clearFile();
    setFeedback("Choose an Excel workbook in .xlsx or .xls format.", true);
    return undefined;
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

/**
 * Derive a filesystem-safe base name for the exported documents.
 * @returns {string} Sanitized report name.
 */
function reportBaseName() {
  return (
    selectedSourceName
      .replace(/\.(xlsx|xls)$/i, "")
      .replace(/[^a-z0-9_-]+/gi, "-")
      .replace(/^-+|-+$/g, "") || "report"
  );
}

/**
 * Turn any label into a filesystem-safe slug.
 * @param {string} value - Raw label.
 * @returns {string} Sanitized slug.
 */
function slugify(value) {
  return String(value)
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Identify one report by its own job reference, falling back to the group index.
 * @param {{group: number, job_ref?: string}} report - A parsed report.
 * @returns {string} Sanitized report identifier.
 */
function reportIdentifier(report) {
  return slugify(report.job_ref || `report-${report.group}`);
}

/**
 * Plan every document the export will produce. Each test report (its `CV1`
 * cover plus `TR1` results) is one document, and the standalone worksheets --
 * the summary, the coral/organic reference, and every `DS1` and `SB1`
 * datasheet -- are each their own separate document.
 *
 * Documents whose kind is currently withheld (see
 * `TEMPORARILY_DISABLED_DOCUMENT_KINDS`) are still planned here and then
 * filtered out, so restoring them needs no change to this function.
 * @param {{sheetNames: string[], sheets: Map<string, Map<string, string>>}} workbook - Parsed workbook.
 * @param {Array<Object>} reports - Detected reports.
 * @returns {Array<{slug: string, title: string, subtitle: string, kind: string, sheets: string[], renderer?: string}>} Planned documents.
 */
function planExportDocuments(workbook, reports) {
  const documents = [];
  const claimed = new Set();

  reports.forEach((report) => {
    const identifier = reportIdentifier(report);
    // The cover and test-result sheets belong to the report, which keeps its
    // established layout: it is served as-is, never re-rendered from the grid.
    [report.sheets.CV1, report.sheets.TR1].filter(Boolean).forEach((name) => claimed.add(name));
    documents.push({
      slug: identifier,
      title: `Test Report ${report.job_ref || report.group}`,
      subtitle: "",
      kind: DOCUMENT_KINDS.REPORT,
      assetPath: REPORT_ASSET_PATH,
      sheets: [],
    });

    // Each supporting datasheet is exported as its own separate document.
    ["DS1", "SB1"].forEach((prefix) => {
      const sheetName = report.sheets[String(prefix)];
      if (!sheetName) return;
      claimed.add(sheetName);
      documents.push({
        slug: `${identifier}-${prefix}`,
        title: `${prefix} Datasheet ${report.job_ref || report.group}`,
        subtitle: sheetName,
        kind: DOCUMENT_KINDS.DATASHEET,
        sheets: [sheetName],
      });
    });
  });

  // Anything outside a report group (Summary, coral + org, …) stands alone.
  workbook.sheetNames.forEach((sheetName) => {
    if (claimed.has(sheetName)) return;
    const isSummary = sheetName.trim() === "Summary";
    const document = {
      slug: slugify(sheetName) || "sheet",
      title: sheetName.trim(),
      subtitle: "",
      kind: isSummary ? DOCUMENT_KINDS.SUMMARY : DOCUMENT_KINDS.WORKSHEET,
      sheets: [sheetName],
    };
    if (isSummary) document.renderer = "summary";
    documents.push(document);
  });

  // Withhold the document kinds that are temporarily disabled. The planning
  // above is deliberately left intact so the full export can be restored.
  return documents.filter(isDocumentEnabled);
}

/**
 * Render one planned document to PDF bytes.
 * @param {{title: string, subtitle: string, sheets: string[], renderer?: string}} plan - Planned document.
 * @param {Map<string, Map<string, string>>} sheets - Per-sheet cell lookups.
 * @returns {Uint8Array|Promise<Uint8Array>} The generated PDF.
 */
function renderDocument(plan, sheets) {
  if (plan.renderer === "summary") {
    const summaryCells = sheets.get(plan.sheets[0]) ?? new Map();
    return globalThis.docuAlignSummaryPdf.createDocument(summaryCells);
  }

  return globalThis.docuAlignPdf.createDocument({
    title: plan.title,
    subtitle: plan.subtitle,
    sections: documentSections(plan, sheets),
  });
}

/**
 * Build the renderable sections for one planned document.
 * @param {{sheets: string[]}} plan - Planned document.
 * @param {Map<string, Map<string, string>>} sheets - Per-sheet cell lookups.
 * @returns {Array<{heading: string, columns: string[], rows: Array<string[]>}>} Sections.
 */
function documentSections(plan, sheets) {
  const reader = globalThis.docuAlignXlsx;
  return plan.sheets.map((sheetName) => {
    const grid = reader.toGrid(sheets.get(sheetName) ?? new Map());
    return { heading: sheetName.trim(), columns: grid.columns, rows: grid.rows };
  });
}

/**
 * Serialise one generated document for persistence and public sharing.
 * The Summary retains its sparse A1 cell lookup so the public viewer can use
 * the approved fixed-format template; generic supporting sheets keep their
 * existing section payload.
 * @param {{sheets: string[], renderer?: string}} plan - Planned document.
 * @param {Map<string, Map<string, string>>} sheets - Per-sheet cell lookups.
 * @returns {string} Bounded JSON document data.
 */
function serializeDocumentData(plan, sheets) {
  if (plan.renderer === "summary") {
    const cells = sheets.get(plan.sheets[0]) ?? new Map();
    return JSON.stringify({ renderer: "summary", cells: [...cells.entries()] });
  }
  return JSON.stringify(documentSections(plan, sheets));
}

/**
 * Generate and download one planned document.
 * @param {Object} plan - Planned document.
 * @param {string} baseName - Sanitized workbook name.
 * @returns {void|Promise<void>}
 */
function downloadDocument(plan, baseName) {
  // Documents backed by a fixed asset (the test report) are served unchanged;
  // only the supporting worksheets are generated from parsed data.
  const isGenerated = !plan.assetPath;
  const triggerDownload = (bytes) => {
    const url = isGenerated
      ? URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }))
      : new URL(plan.assetPath, globalThis.location.href).href;

    const download = document.createElement("a");
    download.href = url;
    download.download = `${baseName}-${plan.slug}.pdf`;
    download.rel = "noopener";
    document.body.appendChild(download);
    download.click();
    download.remove();

    // Release the blob once the browser has taken the download.
    if (isGenerated) setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
  };

  if (!isGenerated) {
    triggerDownload();
    return;
  }

  const rendered = renderDocument(plan, parsedSheets);
  if (rendered instanceof Promise) return rendered.then(triggerDownload);
  triggerDownload(rendered);
}

/**
 * Describe every planned document for persistence and public sharing.
 *
 * Worksheet grids are serialised to JSON here because Firestore cannot store
 * nested arrays, and the same string is what a published share carries so the
 * public viewer can rebuild the PDF.
 * @returns {Array<Object>|null} Serialisable documents, or null before a parse.
 */
function getExportDocuments() {
  if (!parsedDocuments) return null;

  return parsedDocuments.map((plan) => ({
    slug: plan.slug,
    title: plan.title,
    subtitle: plan.subtitle,
    assetPath: plan.assetPath ?? null,
    // The fixed-format test report is served from its asset and carries no data.
    data: plan.assetPath ? null : serializeDocumentData(plan, parsedSheets),
  }));
}

pdfExport.addEventListener("click", () => {
  if (!parsedDocuments) {
    setFeedback("Select and process a workbook before exporting the PDF.", true);
    return;
  }

  const baseName = reportBaseName();
  const documentCount = parsedDocuments.length;
  downloadTimers.forEach((timer) => clearTimeout(timer));
  downloadTimers = parsedDocuments.map((plan, index) =>
    setTimeout(() => {
      const download = downloadDocument(plan, baseName);
      if (download instanceof Promise) {
        download.catch((error) => {
          globalThis.docuAlignLogger?.logError?.(
            "Summary PDF generation failed",
            error,
            {
              feature: "SummaryPdf",
              function: "downloadDocument",
              operation: "pdf.copyAndOverlaySummary",
              category: "LocalPdfGeneration",
              documentSlug: plan.slug,
            },
          );
          setFeedback(`Could not generate ${plan.title}. Try exporting again.`, true);
        });
      }
    }, index * DOWNLOAD_INTERVAL_MS),
  );

  exportStep.classList.add("is-complete");
  saveStep.classList.add("is-active");
  cloudSave.disabled = false;
  setFeedback(
    documentCount === 1
      ? "Started 1 separate PDF. Cloud save is now available."
      : `Started ${documentCount} separate PDFs -- allow multiple downloads if your browser asks. Cloud save is now available.`,
    true,
  );
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
  DOCUMENT_KINDS,
  advancePipeline,
  applyRuntimeNotice,
  clearFile,
  formatFileSize,
  getExportDocuments,
  isExcelFile,
  planExportDocuments,
  reportBaseName,
  reportIdentifier,
  resetPipeline,
  selectFile,
  setDisabledDocumentKinds,
  setFeedback,
  startPipeline,
});
