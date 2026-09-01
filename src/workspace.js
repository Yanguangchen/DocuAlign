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
const workflowBackdrop = document.querySelector("#workflow-backdrop");
const workflowStageLabel = document.querySelector("#workflow-stage-label");
const workflowStageItems = [...document.querySelectorAll("#workflow-stages li")];
const defaultFeedback = "Select a workbook to begin the ETL pipeline.";

/**
 * The drop-to-share workflow's stages, in the order they run.
 *
 * The first two belong to this classic script and the last two to the ES
 * module on `#cloud-save`, so the list is the contract between them: both
 * halves name a stage from here rather than tracking progress separately.
 */
const WORKFLOW_STAGES = ["read", "build", "save", "share"];

/** The queued frame that reveals the throbber, so a fast failure can cancel it. */
let pendingWorkflowFrame = 0;

/**
 * The test report document (`CV1` cover + `TR1` results) keeps the established
 * RAK report layout: `src/rak-report-pdf.js` copies the five pages of this
 * reference asset and overlays only the uploaded workbook's own values, so the
 * approved layout, branding, and typography are preserved while the report
 * carries the data of the file that was actually uploaded.
 *
 * The asset is also served unchanged as a fallback when a workbook cannot be
 * mapped, so an unexpected layout degrades to the reference rather than
 * failing the export.
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

/**
 * The order document kinds take in the export: the client wants the Summary
 * first, then the test reports. The two withheld kinds are ordered here as
 * well so restoring them needs no change to the sort.
 */
const DOCUMENT_KIND_ORDER = Object.freeze([
  DOCUMENT_KINDS.SUMMARY,
  DOCUMENT_KINDS.REPORT,
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

/** Grace period before a download's object URL is released. */
const REVOKE_DELAY_MS = 60000;

let selectedSourceName = "";
let parsedDocuments = null;
let parsedSheets = new Map();
let mappedReports = new Map();

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
  mappedReports = new Map();
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
 * Present the parsed workbook in the shape `src/report-mapping.js` expects.
 *
 * The dependency-free reader keys cells by A1 reference per sheet; the mapper
 * reads plain objects and an image list. The signatures and appendix
 * photographs travel as embedded pictures anchored to worksheet cells, so the
 * reader's per-sheet picture list is passed straight through -- without it the
 * report would keep the reference pages' own photographs.
 * @param {{sheets: Map<string, Map<string, string>>, images?: Map<string, Array>}} workbook - Parsed workbook.
 * @param {string} sourceName - Uploaded file name.
 * @returns {{sourceName: string, sheets: Array<{name: string, cells: Object, images: Array}>}} Mapper input.
 */
function toMappingWorkbook(workbook, sourceName) {
  return {
    sourceName,
    sheets: [...workbook.sheets].map(([name, cells]) => ({
      name,
      cells: Object.fromEntries(cells),
      images: workbook.images?.get(name) ?? [],
    })),
  };
}

/**
 * Warn when a mapped report carries no appendix photographs.
 *
 * A report without photographs is not a rendering failure -- the overlay skips
 * a picture it has no bytes for, so the reference sample's own photographs stay
 * on the page. That is the one failure mode of this pipeline that looks
 * completely normal: a finished report showing another sample's evidence. The
 * warning names the group so a workbook whose photographs are anchored
 * somewhere unexpected can be identified from the console alone, without
 * needing the file itself.
 * @param {Map<number, Object>} models - Semantic report models by group index.
 * @returns {void}
 */
function reportPictureExtraction(models) {
  const empty = [...models.entries()]
    .filter(([, model]) => (model.appendix?.photos ?? []).length === 0)
    .map(([groupIndex]) => groupIndex);
  if (empty.length === 0) return;

  globalThis.docuAlignLogger?.logWarn?.(
    "Some reports carry no appendix photographs",
    new Error(`Groups without photographs: ${empty.join(", ")}`),
    {
      feature: "ReportMapping",
      function: "mapReportModels",
      operation: "mapping.appendixPhotos",
      category: "MissingReportPictures",
      safeIdentifier: empty.join(","),
    },
  );
}

/**
 * Warn when a mapped report carries a value that is not of its own kind.
 *
 * A workbook read at the wrong row is the quietest defect this pipeline has:
 * the export succeeds, the layout is intact, the report is signed, and the
 * vessel name is printed as the sample id. `describeAnomalies` does not know
 * which row was right -- only that a sampling date reading `HH9-638N` is a
 * voyage number -- which is enough to name the group and the field here,
 * while the workbook is still on screen.
 * @param {Map<number, Object>} models - Semantic report models by group index.
 * @returns {void}
 */
function reportValueShapes(models) {
  const mapper = globalThis.docuAlignReportMapping;
  const found = [...models.entries()].flatMap(([groupIndex, model]) =>
    (mapper?.describeAnomalies?.(model) ?? [])
      .map((anomaly) => `group ${groupIndex}: ${anomaly.label} ${anomaly.reason}`));
  if (found.length === 0) return;

  globalThis.docuAlignLogger?.logWarn?.(
    "Some reports carry values that do not look like themselves",
    new Error(found.join("; ")),
    {
      feature: "ReportMapping",
      function: "mapReportModels",
      operation: "mapping.valueShapes",
      category: "ImplausibleReportValues",
      safeIdentifier: String(found.length),
    },
  );
}

/**
 * Map every worksheet group onto its semantic report model, keyed by group.
 *
 * A workbook whose sheets cannot be mapped is not a pipeline failure: the
 * export falls back to serving the reference report, so the reason is logged
 * and an empty map returned.
 * @param {{sheets: Map<string, Map<string, string>>}} workbook - Parsed workbook.
 * @param {string} sourceName - Uploaded file name.
 * @returns {Map<number, Object>} Semantic report models by group index.
 */
function mapReportModels(workbook, sourceName) {
  const mapper = globalThis.docuAlignReportMapping;
  if (!mapper) return new Map();

  try {
    const models = mapper.buildMappedReports(toMappingWorkbook(workbook, sourceName));
    const mapped = new Map(models.map((model) => [model.groupIndex, model]));
    reportPictureExtraction(mapped);
    reportValueShapes(mapped);
    return mapped;
  } catch (error) {
    globalThis.docuAlignLogger?.logWarn?.(
      "Workbook could not be mapped to report models",
      error,
      {
        feature: "ReportMapping",
        function: "mapReportModels",
        operation: "mapping.buildMappedReports",
        category: "WorkbookMapping",
      },
    );
    return new Map();
  }
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
    mappedReports = mapReportModels(workbook, file.name);
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

input.addEventListener("change", () => runWorkbookWorkflow(input.files[0]));
document.querySelector("#replace-file").addEventListener("click", () => input.click());
document.querySelector("#remove-file").addEventListener("click", () => {
  clearFile();
  setFeedback(defaultFeedback, false);
});

/**
 * Advance the drop-to-share throbber to one stage, opening it if needed.
 *
 * Opening on demand means the cloud-save controller can call this for its own
 * stages whether it was reached through the automatic workflow or by someone
 * pressing "Save data to cloud" directly -- both deserve the same feedback,
 * and neither has to know which happened.
 * @param {string} stage - A name from `WORKFLOW_STAGES`.
 * @param {string} label - What to tell the person waiting.
 * @returns {void}
 */
function setWorkflowStage(stage, label) {
  const reached = WORKFLOW_STAGES.indexOf(stage);
  if (reached === -1) return;

  if (workflowBackdrop.hidden) {
    workflowBackdrop.hidden = false;
    // One frame between "displayed" and "open" so the transition has two
    // states to move between; setting both together animates nothing.
    pendingWorkflowFrame = requestAnimationFrame(() => {
      workflowBackdrop.classList.add("is-open");
    });
  }

  workflowStageLabel.textContent = label;
  workflowStageItems.forEach((item) => {
    const position = WORKFLOW_STAGES.indexOf(item.dataset.stage);
    item.classList.toggle("is-done", position < reached);
    item.classList.toggle("is-active", position === reached);
  });
}

/**
 * Close the throbber, whether the workflow finished or gave up.
 * @returns {void}
 */
function endWorkflow() {
  // A workflow can fail inside the frame that was queued to open the throbber,
  // which would otherwise leave it marked open behind a hidden element and
  // skip the entrance animation on the next run.
  cancelAnimationFrame(pendingWorkflowFrame);
  workflowBackdrop.classList.remove("is-open");
  workflowBackdrop.hidden = true;
  workflowStageItems.forEach((item) => {
    item.classList.remove("is-done", "is-active");
  });
}

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
 * Strip what no file name may carry, while keeping the spaces, brackets and
 * underscores the house naming convention is written with.
 *
 * The set removed is Windows' -- the strictest of the platforms staff save
 * these files on -- plus control characters, and leading or trailing dots and
 * spaces, which Windows silently drops from a saved file's name.
 * @param {string} value - Raw label.
 * @returns {string} A name safe to save under, possibly empty.
 */
function safeFileName(value) {
  return String(value ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+|[\s.]+$/g, "");
}

/**
 * The package-level job reference, taken from a report's own cover reference.
 *
 * A cover carries the reference of one sample (`X-2026-522-1`); the package
 * they all belong to is that reference without the sample index, which is what
 * every exported file is named after. Used only when the Summary sheet -- the
 * sheet that states the package reference outright -- is absent.
 * @param {Array<{job_ref?: string}>} reports - Detected reports, in workbook order.
 * @returns {string} The package job reference, or an empty string.
 */
function packageJobRef(reports) {
  const reference = String(reports.find((report) => report.job_ref)?.job_ref ?? "").trim();
  return reference.replace(/-\d+$/, "");
}

/**
 * The job reference and voyage number every exported file is named after.
 *
 * Both are read from the Summary sheet, which states them for the package as a
 * whole: `U10` is the job reference covering every sample, and `U12` the
 * voyage number. A workbook with no Summary falls back to the reports' own
 * covers, which carry the same two values per sample.
 * @param {{sheetNames?: string[], sheets?: Map<string, Map<string, string>>}} workbook - Parsed workbook.
 * @param {Array<Object>} reports - Detected reports, in workbook order.
 * @param {Map<number, Object>} models - Semantic report models by group index.
 * @returns {{jobRef: string, voyageNumber: string}} The package's identity.
 */
function packageIdentity(workbook, reports, models) {
  const summarySheet = (workbook.sheetNames ?? []).find(isSummarySheet);
  const cells = workbook.sheets?.get(summarySheet) ?? new Map();
  const cell = (address) => String(cells.get(address) ?? "").trim();
  const firstCover = models.get(reports.find((report) => models.has(report.group))?.group)?.cover;

  return {
    jobRef: cell("U10") || packageJobRef(reports),
    voyageNumber: cell("U12") || String(firstCover?.voyageNumber ?? "").trim(),
  };
}

/**
 * Name one exported document the way the lab names them by hand:
 * `X-2026-1338 (AV-2620N_RAK SUMMARY)` for the summary, and
 * `X-2026-1338 (AV-2620N_RAK1)`, `…_RAK2`, … for the test reports in the order
 * the workbook lists them.
 *
 * A workbook missing either half of its identity still names its files: the
 * empty half drops out rather than leaving `undefined` in the name. Only when
 * both are missing is there nothing to build a name from, and the caller keeps
 * its own descriptive title instead.
 * @param {{jobRef: string, voyageNumber: string}} identity - The package's identity.
 * @param {string} suffix - `RAK SUMMARY`, `RAK1`, `RAK2`, …
 * @returns {string} The document's name, or an empty string.
 */
function conventionalName(identity, suffix) {
  const { jobRef, voyageNumber } = identity;
  if (!jobRef && !voyageNumber) return "";
  const bracketed = [voyageNumber, suffix].filter(Boolean).join("_");
  return safeFileName([jobRef, `(${bracketed})`].filter(Boolean).join(" "));
}

/**
 * Whether a worksheet is the workbook's Summary sheet.
 * @param {string} sheetName - Worksheet tab name.
 * @returns {boolean} True for the Summary sheet.
 */
function isSummarySheet(sheetName) {
  return sheetName.trim() === "Summary";
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
 * Claim a slug no other planned document is using.
 *
 * A document's slug is both its file name in the export archive and its
 * Firestore document id, so a duplicate does not merely look untidy: the
 * second document overwrites the first, and every card that points at it then
 * serves the wrong report. One job reference covering several cargo holds is
 * ordinary lab practice, so collisions are expected rather than exotic.
 * @param {string} preferred - The slug the document would like.
 * @param {string|number} suffix - Disambiguator when the preferred slug is taken.
 * @param {Set<string>} used - Slugs already claimed by this plan.
 * @returns {string} A slug unique within the plan, now claimed.
 */
function claimSlug(preferred, suffix, used) {
  let slug = preferred;
  let attempt = 0;
  while (used.has(slug)) {
    attempt += 1;
    slug = attempt === 1 ? `${preferred}-${suffix}` : `${preferred}-${suffix}-${attempt}`;
  }
  used.add(slug);
  return slug;
}

/**
 * Claim a document name no other planned document is using.
 *
 * A name is what the document saves as, so two documents sharing one would
 * overwrite each other in the recipient's downloads folder. The convention
 * itself keeps them apart -- one Summary, then `RAK1`, `RAK2`, … -- so this
 * only catches a workbook odd enough to plan the same name twice.
 * @param {string} preferred - The name the document would like.
 * @param {Set<string>} used - Names already claimed by this plan.
 * @returns {string} A name unique within the plan, now claimed.
 */
function claimName(preferred, used) {
  let name = preferred;
  let attempt = 1;
  while (used.has(name)) {
    attempt += 1;
    name = `${preferred} (${attempt})`;
  }
  used.add(name);
  return name;
}

/**
 * Plan every document the export will produce. Each test report (its `CV1`
 * cover plus `TR1` results) is one document, and the standalone worksheets --
 * the summary, the coral/organic reference, and every `DS1` and `SB1`
 * datasheet -- are each their own separate document.
 *
 * The Summary and the test reports are named by the lab's own convention --
 * `X-2026-1338 (AV-2620N_RAK SUMMARY)`, then `…_RAK1`, `…_RAK2`, … numbered in
 * the order the workbook lists them -- so an exported package is
 * indistinguishable from one named by hand. That name is the document's title
 * throughout: it is what the archive entry is called, what the dashboard and
 * the public viewer show, and what a shared document downloads as.
 *
 * Documents whose kind is currently withheld (see
 * `TEMPORARILY_DISABLED_DOCUMENT_KINDS`) are still planned here and then
 * filtered out, so restoring them needs no change to this function.
 * @param {{sheetNames: string[], sheets: Map<string, Map<string, string>>}} workbook - Parsed workbook.
 * @param {Array<Object>} reports - Detected reports.
 * @param {Map<number, Object>} [models] - Semantic report models by group index.
 * @returns {Array<{slug: string, title: string, subtitle: string, kind: string, sheets: string[], renderer?: string}>} Planned documents.
 */
function planExportDocuments(workbook, reports, models = mappedReports) {
  const documents = [];
  const claimed = new Set();
  // Slugs are Firestore ids, so they must not repeat across the whole plan --
  // see claimSlug. Names are what the documents save as -- see claimName.
  const slugs = new Set();
  const names = new Set();
  const identity = packageIdentity(workbook, reports, models);

  reports.forEach((report, position) => {
    const identifier = claimSlug(reportIdentifier(report), report.group, slugs);
    // The cover and test-result sheets belong to the report, which keeps its
    // established layout: the reference pages are copied and only this group's
    // own values are overlaid, never re-laid-out from the worksheet grid.
    [report.sheets.CV1, report.sheets.TR1].filter(Boolean).forEach((name) => claimed.add(name));
    const document = {
      slug: identifier,
      // `RAK1` for the first report the workbook lists, `RAK2` for the second,
      // and so on. A workbook with neither a job reference nor a voyage number
      // has nothing to name a document by, so it keeps a descriptive title.
      title: claimName(
        conventionalName(identity, `RAK${position + 1}`)
          || `Test Report ${report.job_ref || report.group}`,
        names,
      ),
      subtitle: "",
      kind: DOCUMENT_KINDS.REPORT,
      groupIndex: report.group,
      sheets: [],
    };
    // Without a mapped model there is nothing to overlay, so the reference
    // report is served unchanged rather than exporting nothing at all.
    if (models.has(report.group)) document.renderer = "report";
    else document.assetPath = REPORT_ASSET_PATH;
    // Carried on the plan so the export's chronological order is fixed
    // when the workbook is parsed, not re-derived from module state later.
    document.samplingDate = models.get(report.group)?.cover?.samplingDate ?? "";
    documents.push(document);

    // Each supporting datasheet is exported as its own separate document.
    ["DS1", "SB1"].forEach((prefix) => {
      const sheetName = report.sheets[String(prefix)];
      if (!sheetName) return;
      claimed.add(sheetName);
      documents.push({
        slug: claimSlug(`${identifier}-${prefix}`, report.group, slugs),
        title: `${prefix} Datasheet ${report.job_ref || report.group}`,
        subtitle: sheetName,
        kind: DOCUMENT_KINDS.DATASHEET,
        sheets: [sheetName],
      });
    });
  });

  // Anything outside a report group (Summary, coral + org, …) stands alone.
  workbook.sheetNames.forEach((sheetName, index) => {
    if (claimed.has(sheetName)) return;
    const isSummary = isSummarySheet(sheetName);
    const document = {
      slug: claimSlug(slugify(sheetName) || "sheet", index + 1, slugs),
      title: isSummary
        ? claimName(conventionalName(identity, "RAK SUMMARY") || sheetName.trim(), names)
        : sheetName.trim(),
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
  // The test report copies the approved reference pages and overlays this
  // group's mapped values, so the exported PDF carries the uploaded data.
  if (plan.renderer === "report") {
    return globalThis.docuAlignRakReportPdf.createRakReportPdf([
      mappedReports.get(plan.groupIndex),
    ]);
  }

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
 * The stable key identifying one of a report's embedded pictures.
 *
 * Shared by the upload and the published payload so a viewer can pair a
 * picture's metadata back up with the file that was uploaded for it.
 * @param {number} groupIndex - The report's worksheet group.
 * @param {string} slot - `preparedSignature`, `authorisedSignature`, or `photo`.
 * @param {number} [index] - Position, for the appendix photographs.
 * @returns {string} Asset key.
 */
function pictureKey(groupIndex, slot, index) {
  return index === undefined ? `${groupIndex}:${slot}` : `${groupIndex}:${slot}:${index}`;
}

/**
 * Every embedded picture the mapped reports carry, ready to upload.
 *
 * A share's `documentData` is bounded at 100,000 characters, and one report's
 * pictures run to hundreds of kilobytes, so the bytes cannot travel in the
 * payload. They are uploaded once at save time instead and the payload carries
 * each picture's URL.
 * @returns {Array<{key: string, mimeType: string, bytes: Uint8Array}>} Pictures with bytes.
 */
function getPublishableAssets() {
  const assets = [];
  const collect = (asset, key) => {
    if (asset?.bytes?.length) {
      assets.push({ key, mimeType: asset.mimeType, bytes: asset.bytes });
    }
  };

  mappedReports.forEach((report, groupIndex) => {
    collect(report.assets?.preparedSignature, pictureKey(groupIndex, "preparedSignature"));
    collect(report.assets?.authorisedSignature, pictureKey(groupIndex, "authorisedSignature"));
    (report.appendix?.photos ?? []).forEach((photo, index) => {
      collect(photo, pictureKey(groupIndex, "photo", index));
    });
  });

  return assets;
}

/**
 * Describe a mapped report's embedded pictures without their bytes.
 *
 * The downloaded report renders from the in-memory model, which carries the
 * workbook's signatures and appendix photographs in full. A published share
 * cannot: one report's pictures run to megabytes, far past the 100,000
 * character `documentData` bound the Firestore rules validate in a single
 * expression. Only the metadata travels -- plus, for a picture that was
 * uploaded to Cloud Storage, the URL the viewer refetches it from, so a share
 * shows the uploaded workbook's own artwork rather than the reference's.
 * @param {Object} report - Semantic report model.
 * @param {number} groupIndex - The report's worksheet group.
 * @param {Map<string, string>} pictureUrls - Asset key to uploaded picture URL.
 * @returns {Object} The report with picture bytes replaced by metadata and URLs.
 */
function withoutPictureBytes(report, groupIndex, pictureUrls) {
  const describe = (asset, key) => {
    if (!asset) return asset;
    const url = pictureUrls.get(key);
    const described = {
      name: asset.name,
      row: asset.row,
      column: asset.column,
      mimeType: asset.mimeType,
    };
    // The uploaded bytes are the whole picture, including the edge Excel
    // crops away, so the crop has to travel with them: a share that dropped it
    // would draw the hidden edge the downloaded report does not.
    if (asset.crop) described.crop = asset.crop;
    // Absent when the picture had no bytes, or its upload failed; the viewer
    // then keeps the reference artwork for that one image.
    if (url) described.url = url;
    return described;
  };

  return Object.assign({}, report, {
    assets: {
      preparedSignature: describe(
        report.assets?.preparedSignature,
        pictureKey(groupIndex, "preparedSignature"),
      ),
      authorisedSignature: describe(
        report.assets?.authorisedSignature,
        pictureKey(groupIndex, "authorisedSignature"),
      ),
    },
    appendix: Object.assign({}, report.appendix, {
      photos: (report.appendix?.photos ?? []).map(
        (photo, index) => describe(photo, pictureKey(groupIndex, "photo", index)),
      ),
    }),
  });
}

/**
 * Serialise one generated document for persistence and public sharing.
 * The Summary retains its sparse A1 cell lookup so the public viewer can use
 * the approved fixed-format template; generic supporting sheets keep their
 * existing section payload.
 * @param {{sheets: string[], renderer?: string}} plan - Planned document.
 * @param {Map<string, Map<string, string>>} sheets - Per-sheet cell lookups.
 * @param {Map<string, string>} pictureUrls - Asset key to uploaded picture URL.
 * @returns {string} Bounded JSON document data.
 */
function serializeDocumentData(plan, sheets, pictureUrls) {
  if (plan.renderer === "report") {
    return JSON.stringify({
      renderer: "report",
      report: withoutPictureBytes(
        mappedReports.get(plan.groupIndex),
        plan.groupIndex,
        pictureUrls,
      ),
    });
  }
  if (plan.renderer === "summary") {
    const cells = sheets.get(plan.sheets[0]) ?? new Map();
    return JSON.stringify({ renderer: "summary", cells: [...cells.entries()] });
  }
  return JSON.stringify(documentSections(plan, sheets));
}

/**
 * Render one planned document to PDF bytes for the archive.
 *
 * A document backed by the reference asset carries no data of its own, so its
 * bytes are fetched rather than generated.
 * @param {Object} plan - Planned document.
 * @returns {Promise<Uint8Array>} The document's PDF bytes.
 */
async function documentBytes(plan) {
  if (plan.assetPath) {
    const response = await fetch(new URL(plan.assetPath, globalThis.location.href).href);
    if (!response.ok) {
      throw new Error(`Could not read the reference report (${response.status}).`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  const rendered = await renderDocument(plan, parsedSheets);
  if (rendered instanceof Blob) return new Uint8Array(await rendered.arrayBuffer());
  return rendered instanceof Uint8Array ? rendered : new Uint8Array(rendered);
}

/**
 * Record a document's generation failure without stopping the export.
 * @param {Object} plan - Planned document.
 * @param {unknown} error - The failure raised while rendering.
 * @returns {void}
 */
function logDocumentFailure(plan, error) {
  const isReport = plan.renderer === "report";
  globalThis.docuAlignLogger?.logError?.(
    isReport ? "Test report PDF generation failed" : "Summary PDF generation failed",
    error,
    {
      feature: isReport ? "PdfTemplate" : "SummaryPdf",
      function: "buildExportArchive",
      operation: isReport ? "pdf.copyAndOverlay" : "pdf.copyAndOverlaySummary",
      category: "LocalPdfGeneration",
      documentSlug: plan.slug,
    },
  );
}

/**
 * Convert a cover sheet's sampling date into a sortable number.
 *
 * The workbook writes it day-first (`08/04/2026`); ISO (`2026-04-08`) is
 * accepted too. Anything else -- an empty cell, a report served from the
 * reference asset, a format neither pattern matches -- sorts last rather than
 * being guessed at, and keeps the workbook's own order among its peers.
 * @param {string} value - The cover sheet's sampling date.
 * @returns {number} A comparable `yyyymmdd` number, or Infinity when unparsed.
 */
function samplingOrder(value) {
  const text = String(value ?? "").trim();
  const dayFirst = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
  if (dayFirst) {
    const [, day, month, year] = dayFirst;
    return Number(year) * 10000 + Number(month) * 100 + Number(day);
  }
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (iso) {
    const [, year, month, day] = iso;
    return Number(year) * 10000 + Number(month) * 100 + Number(day);
  }
  return Number.POSITIVE_INFINITY;
}

/**
 * Order the planned documents for the export: the Summary first, then
 * every test report by sampling date.
 *
 * `Array.prototype.sort` is stable, so reports sharing a sampling date -- the
 * usual case, one vessel sampled across a single day -- keep the workbook's
 * own order, which is the order the Summary table lists them in.
 * @param {Array<Object>} documents - Planned documents.
 * @returns {Array<Object>} A new list in export order.
 */
function exportOrder(documents) {
  return [...documents].sort((left, right) => {
    const byKind = DOCUMENT_KIND_ORDER.indexOf(left.kind)
      - DOCUMENT_KIND_ORDER.indexOf(right.kind);
    if (byKind !== 0) return byKind;
    const leftDate = samplingOrder(left.samplingDate);
    const rightDate = samplingOrder(right.samplingDate);
    // Compared rather than subtracted: two undated documents are both
    // Infinity, and Infinity - Infinity is NaN, which sorts unpredictably.
    if (leftDate === rightDate) return 0;
    return leftDate < rightDate ? -1 : 1;
  });
}

/**
 * The file name one planned document is archived under.
 *
 * The title is the name the lab would have typed -- see
 * `planExportDocuments` -- so the archive simply carries it. A title with
 * nothing savable in it falls back to the document's slug, which is sanitized
 * by construction.
 * @param {{title: string, slug: string}} plan - Planned document.
 * @returns {string} The document's file name, extension included.
 */
function documentFileName(plan) {
  return `${safeFileName(plan.title) || plan.slug}.pdf`;
}

/**
 * Render every planned document and pack them into one archive.
 *
 * Each document stays its own file: the archive is only a wrapper so there is
 * one download rather than a burst of them. Entries are named into a folder
 * so the archive unpacks tidily, and ordered the way `exportOrder` decides.
 *
 * A document that fails to render is left out rather than failing the whole
 * export: the rest are still worth having, and the caller reports what was
 * dropped.
 *
 * Takes the plan list explicitly, rather than reading it off module state,
 * so a reset that runs while this is in flight can never change which
 * documents it renders midway through.
 * @param {Array<Object>} documents - Planned documents, as captured at click time.
 * @param {string} baseName - Sanitized workbook name.
 * @returns {Promise<{archive: Uint8Array, included: number, failed: string[]}>} The archive.
 */
async function buildExportArchive(documents, baseName) {
  const entries = [];
  const failed = [];

  for (const plan of exportOrder(documents)) {
    try {
      entries.push({
        name: `${baseName}/${documentFileName(plan)}`,
        data: await documentBytes(plan),
      });
    } catch (error) {
      logDocumentFailure(plan, error);
      failed.push(plan.title);
    }
  }

  if (entries.length === 0) throw new Error("No document could be generated.");
  return {
    archive: globalThis.docuAlignZip.createArchive(entries),
    included: entries.length,
    failed,
  };
}

/**
 * Download the finished archive as a single file.
 * @param {Uint8Array} archive - Archive bytes.
 * @param {string} baseName - Sanitized workbook name.
 * @returns {void}
 */
function downloadArchive(archive, baseName) {
  const url = URL.createObjectURL(new Blob([archive], { type: "application/zip" }));
  const download = document.createElement("a");
  download.href = url;
  download.download = `${baseName}.zip`;
  download.rel = "noopener";
  document.body.appendChild(download);
  download.click();
  download.remove();
  // Release the blob once the browser has taken the download.
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

/**
 * Describe every planned document for persistence and public sharing.
 *
 * Worksheet grids are serialised to JSON here because Firestore cannot store
 * nested arrays, and the same string is what a published share carries so the
 * public viewer can rebuild the PDF.
 * @param {Map<string, string>} [pictureUrls] - Asset key to uploaded picture
 * URL, from `getPublishableAssets()`. Omitted before the pictures are
 * uploaded, in which case a share keeps the reference pages' own artwork.
 * @returns {Array<Object>|null} Serialisable documents, or null before a parse.
 */
function getExportDocuments(pictureUrls = new Map()) {
  if (!parsedDocuments) return null;

  return parsedDocuments.map((plan) => ({
    slug: plan.slug,
    title: plan.title,
    subtitle: plan.subtitle,
    assetPath: plan.assetPath ?? null,
    // The fixed-format test report is served from its asset and carries no data.
    data: plan.assetPath ? null : serializeDocumentData(plan, parsedSheets, pictureUrls),
  }));
}

/**
 * Build and download the export archive for the current workbook.
 *
 * Separated from the click listener so the drop-to-share workflow can await
 * the same run the button performs, rather than racing an event handler.
 * @returns {Promise<boolean>} Whether an archive actually downloaded.
 */
async function runExport() {
  if (!parsedDocuments) {
    setFeedback("Select and process a workbook before exporting the PDF.", true);
    return false;
  }
  // A repeat click while a build is running cannot re-enter here: disabling
  // the button below (per the HTML click() algorithm) stops a disabled
  // button from dispatching further click events at all.

  // One archive rather than a burst of downloads: browsers throttle multiple
  // programmatic downloads and prompt before allowing them. The plan list is
  // captured now so a reset mid-build can be detected below rather than
  // silently changing which documents this call renders.
  const documents = parsedDocuments;
  const baseName = reportBaseName();
  pdfExport.disabled = true;
  setFeedback("Generating documents\u2026", true);

  try {
    const { archive, included, failed } = await buildExportArchive(documents, baseName);
    // The workbook was cleared or replaced while this was building; the
    // archive describes a workbook that is no longer selected; drop it.
    if (parsedDocuments !== documents) return false;
    downloadArchive(archive, baseName);

    exportStep.classList.add("is-complete");
    saveStep.classList.add("is-active");
    cloudSave.disabled = false;
    const documentCount = `${included} ${included === 1 ? "document" : "documents"}`;
    setFeedback(
      failed.length === 0
        ? `Downloaded ${baseName}.zip with ${documentCount}. Cloud save is now available.`
        : `Downloaded ${baseName}.zip with ${documentCount}; could not generate ${failed.join(", ")}.`,
      true,
    );
    return true;
  } catch (error) {
    if (parsedDocuments !== documents) return false;
    setFeedback(`Could not build the export. ${error.message}`, true);
    return false;
  } finally {
    // Only re-enable for the workbook this build was for; a reset already
    // set the button's disabled state appropriately for whatever came after.
    if (parsedDocuments === documents) pdfExport.disabled = false;
  }
}

pdfExport.addEventListener("click", runExport);

/**
 * Carry a freshly chosen workbook all the way through: parse it, download the
 * export, and save it to the cloud, without waiting for three separate clicks.
 *
 * Only the interactive entry points (drop and file picker) run this. The
 * `selectFile` API stays a plain parse so scripted callers and tests can drive
 * each stage on their own terms.
 *
 * Each stage gates the next on real success, so a workbook that fails to parse
 * never downloads, and a failed export never reaches the cloud save.
 * @param {File} file - The dropped or chosen workbook.
 * @returns {Promise<void>} Resolves once the workflow settles.
 */
async function runWorkbookWorkflow(file) {
  const pipeline = selectFile(file);
  if (!pipeline) return;

  setWorkflowStage("read", "Reading the workbook…");
  await pipeline;
  // A failed pipeline leaves no plan behind, and the export button disabled.
  if (!parsedDocuments) {
    endWorkflow();
    return;
  }

  setWorkflowStage("build", "Building the PDFs…");
  if (!(await runExport())) {
    endWorkflow();
    return;
  }

  // The cloud-save controller is an ES module listening on this button, so
  // the click is how the classic workspace script hands the workflow over.
  // It publishes the share link and opens the send-it-now modal from there,
  // and drives the remaining two stages of the throbber through the globals
  // exposed at the foot of this file.
  cloudSave.click();
}

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
  runWorkbookWorkflow(event.dataTransfer.files[0]);
});

applyRuntimeNotice();

// Exposed read-only for focused tests and support-console inspection. Runtime
// UI code continues to use the locally scoped functions above.
globalThis.docuAlignWorkspace = Object.freeze({
  DOCUMENT_KINDS,
  advancePipeline,
  applyRuntimeNotice,
  clearFile,
  conventionalName,
  documentFileName,
  endWorkflow,
  exportOrder,
  formatFileSize,
  getExportDocuments,
  getPublishableAssets,
  isExcelFile,
  packageIdentity,
  planExportDocuments,
  reportBaseName,
  safeFileName,
  reportIdentifier,
  resetPipeline,
  selectFile,
  setDisabledDocumentKinds,
  setFeedback,
  setWorkflowStage,
  startPipeline,
});
