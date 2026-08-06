/**
 * @file dashboard.js
 * @description Controller logic for the saved reports cloud dashboard (`dashboard.html`).
 * Fetches all persisted reports from Firestore upon authentication, renders interactive
 * report cards, and provides real-time date filtering and status feedback.
 */
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "./lib/firebase.js";
import {
  deleteReport,
  fetchReportDocuments,
  fetchReports,
  filterReportsByDate,
} from "./lib/reports.js";
import { buildBundleUrl, buildPublicUrl, publishBundle, publishReport } from "./lib/share.js";
import { logWarn, trackOperation } from "./lib/logger.js";
import { initObservability } from "./lib/observability.js";

initObservability();

const filterForm = document.querySelector("#date-filter");
const fromInput = document.querySelector("#filter-from");
const toInput = document.querySelector("#filter-to");
const status = document.querySelector("#dashboard-status");
const grid = document.querySelector("#report-grid");
const resultCount = document.querySelector("#result-count");
const bundleBar = document.querySelector("#bundle-bar");
const bundleCount = document.querySelector("#bundle-count");
const bundleCreate = document.querySelector("#bundle-create");
const bundleLink = document.querySelector("#bundle-link");

let allReports = [];
let loadedForUser = null;
// Documents ticked for grouping into one package, keyed `reportId::slug`; a
// bare reportId means the report itself. Survives re-renders.
const bundleSelection = new Set();
// Exported documents per report id, loaded alongside the reports.
const reportDocuments = new Map();

/**
 * Build the stable selection key for one selectable document.
 * @param {string} reportId - Saved report id.
 * @param {string} [slug] - Document slug; omitted for the report itself.
 * @returns {string} Selection key.
 */
export function selectionKey(reportId, slug) {
  return slug ? `${reportId}::${slug}` : reportId;
}

/**
 * Resolve the current selection into publishable `{ report, document }` pairs.
 * @returns {Array<{report: Object, document: Object|null}>} Selected entries.
 */
/**
 * Look up a report's stored documents, tolerating reports rendered before the
 * document load has completed.
 * @param {string} reportId - Saved report id.
 * @returns {Array<Object>} Stored documents, possibly empty.
 */
function documentsFor(reportId) {
  return reportDocuments.get(reportId) ?? [];
}

export function selectedEntries() {
  const entries = [];
  allReports.forEach((report) => {
    documentsFor(report.id).forEach((entry) => {
      if (bundleSelection.has(selectionKey(report.id, entry.slug))) {
        entries.push({ report, document: entry });
      }
    });
    if (bundleSelection.has(report.id)) entries.push({ report, document: null });
  });
  return entries;
}

/**
 * Copy a URL to the clipboard, best-effort.
 * @param {string} url - The URL to copy.
 * @param {string} caller - Logging context for a failed copy.
 * @returns {Promise<boolean>} Whether the copy succeeded, so a caller driving
 * its own UI feedback (the persistent copy button) can tell success from
 * failure rather than assuming the silent-by-design creation-time copy.
 */
async function copyToClipboard(url, caller) {
  if (!navigator.clipboard?.writeText) return false;

  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch (error) {
    // Copying is a convenience and must not hide the rendered capability URL,
    // but failures remain useful for diagnosing browser permission issues.
    logWarn("Clipboard copy failed", {
      feature: "PublicShare",
      function: caller,
      operation: "clipboard.writeText",
      category: "ClipboardFailure",
      errorMessage: String(error),
    });
    return false;
  }
}

/** Static two-rectangle "copy" icon; no interpolated data, so innerHTML is safe. */
const COPY_ICON_MARKUP = '<svg viewBox="0 0 24 24" aria-hidden="true">'
  + '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>'
  + '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>'
  + "</svg>";

/** How long the "Copied!" feedback stays visible after a click. */
const COPY_FEEDBACK_MS = 2000;

/**
 * Build a small icon button that re-copies an already-published URL on
 * demand, so staff are not stuck selecting the rendered link text and
 * pressing Ctrl+C every time they want it again after the one-time
 * copy-on-creation.
 * @param {string} url - The published URL this button copies.
 * @param {string} caller - Logging context for a failed copy.
 * @returns {HTMLElement} A `<span>` wrapping the button and its feedback text.
 */
function createCopyLinkButton(url, caller) {
  const wrap = document.createElement("span");
  wrap.className = "copy-link";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "copy-link-button";
  button.setAttribute("aria-label", "Copy link");
  button.innerHTML = COPY_ICON_MARKUP;

  const feedback = document.createElement("span");
  feedback.className = "copy-feedback";
  feedback.setAttribute("aria-live", "polite");

  let hideTimer;
  button.addEventListener("click", async () => {
    const copied = await copyToClipboard(url, caller);
    clearTimeout(hideTimer);
    feedback.textContent = copied ? "Copied!" : "Could not copy — select the link instead.";
    button.classList.toggle("is-copied", copied);
    hideTimer = setTimeout(() => {
      feedback.textContent = "";
      button.classList.remove("is-copied");
    }, COPY_FEEDBACK_MS);
  });

  wrap.append(button, feedback);
  return wrap;
}

/**
 * Render a published capability URL alongside a persistent copy button.
 * @param {HTMLElement} container - Element to fill (`.share-link` or `#bundle-link`).
 * @param {string} url - The published URL.
 * @param {string} caller - Logging context for a failed copy.
 * @returns {void}
 */
function renderShareLink(container, url, caller) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noopener";
  anchor.textContent = url;

  container.replaceChildren(anchor, createCopyLinkButton(url, caller));
  container.hidden = false;
}

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

export function setStatus(message) {
  if (message) {
    status.textContent = message;
    status.hidden = false;
    grid.hidden = true;
  } else {
    status.hidden = true;
    grid.hidden = false;
  }
}

/**
 * Render the per-document picker for a saved report, so any individual
 * document can be ticked into a package independently of the others.
 * @param {Object} report - A saved report.
 * @returns {string} Picker markup, or an empty string when nothing is stored.
 */
export function documentPicker(report) {
  const documents = documentsFor(report.id);
  // Reports saved before documents were persisted have nothing to list. Say so
  // rather than silently offering only the whole-report tick-box, which would
  // quietly produce a package containing just the test report.
  if (documents.length === 0) {
    return `
      <p class="report-documents-empty">
        No individual documents stored. Re-upload this workbook, export it, and
        save again to package its summary, DS1 and SB1 documents.
      </p>
    `;
  }

  const items = documents
    .map(
      (entry) => `
        <li>
          <label class="bundle-select">
            <input
              type="checkbox"
              class="bundle-checkbox"
              data-report-id="${escapeHtml(report.id)}"
              data-document-slug="${escapeHtml(entry.slug)}"
            />
            ${escapeHtml(entry.title)}
          </label>
        </li>
      `,
    )
    .join("");

  return `
    <details class="report-documents">
      <summary>${documents.length} documents</summary>
      <ul class="document-list">${items}</ul>
    </details>
  `;
}

export function reportCard(report) {
  const title = report.reportName || report.sourceFileName || "Untitled report";
  const created = report.createdAt
    ? dateFormatter.format(report.createdAt)
    : "Date unavailable";
  const statusLabel = report.status || "saved";
  const source = report.sourceFileName
    ? `<p class="report-source">${escapeHtml(report.sourceFileName)}</p>`
    : "";
  const savedBy = report.createdBy
    ? `<span class="report-meta-item">${escapeHtml(report.createdBy)}</span>`
    : "";
  // Only saved documents can be shared: the public snapshot references the
  // Firestore id, so a report without one has nothing durable to point at.
  const documentCount = documentsFor(report.id).length;
  const shareLabel = documentCount > 1
    ? `Create public link (${documentCount} documents)`
    : "Create public link";
  const share = report.id
    ? `
      <div class="report-share">
        <button class="share-button" type="button" data-report-id="${escapeHtml(report.id)}">
          ${escapeHtml(shareLabel)}
        </button>
        <label class="bundle-select">
          <input
            type="checkbox"
            class="bundle-checkbox"
            data-report-id="${escapeHtml(report.id)}"
          />
          Add to package
        </label>
        ${documentPicker(report)}
        <p class="share-link" aria-live="polite" hidden></p>
        <button
          class="delete-button"
          type="button"
          data-report-id="${escapeHtml(report.id)}"
          data-armed="false"
        >
          Delete
        </button>
      </div>
    `
    : "";

  return `
    <li class="report-card">
      <div class="report-card-head">
        <strong>${escapeHtml(title)}</strong>
        <span class="report-status">${escapeHtml(statusLabel)}</span>
      </div>
      ${source}
      <div class="report-card-meta">
        <span class="report-meta-item">${escapeHtml(created)}</span>
        ${savedBy}
      </div>
      ${share}
    </li>
  `;
}

// Reflect the current group selection in the bundle bar. Any selection change
// re-arms the create button and hides a previously produced link, since the
// selection it referred to has changed.
export function updateBundleBar() {
  const count = bundleSelection.size;
  bundleBar.hidden = count === 0;
  bundleCount.textContent = `${count} ${count === 1 ? "document" : "documents"} selected`;
  bundleCreate.disabled = false;
  bundleCreate.textContent = "Create package link";
  bundleLink.hidden = true;
}

// Re-rendering rebuilds the card DOM, so restore each checkbox from the
// selection set and drop ids whose cards are no longer in the grid (e.g.
// filtered out by the date range).
function syncBundleSelection() {
  const boxes = [...grid.querySelectorAll(".bundle-checkbox")];
  const visible = new Set(
    boxes.map((box) => selectionKey(box.dataset.reportId, box.dataset.documentSlug)),
  );
  for (const key of bundleSelection) {
    if (!visible.has(key)) bundleSelection.delete(key);
  }
  for (const box of boxes) {
    box.checked = bundleSelection.has(selectionKey(box.dataset.reportId, box.dataset.documentSlug));
  }
  updateBundleBar();
}

// Publish every selected report behind one group URL: each report becomes an
// ordinary public share, and the bundle document ties their tokens together
// so the customer sees all grouped PDF exports on a single page.
export async function handleBundleClick() {
  const entries = selectedEntries();
  if (entries.length === 0) return;

  bundleCreate.disabled = true;

  try {
    const token = await trackOperation(
      "Publish group link",
      {
        feature: "PublicShare",
        function: "handleBundleClick",
        operation: "firestore.setDoc",
        collection: "docuAlignPublicBundles",
        safeIdentifier: `selection:${entries.length}`,
      },
      () => publishBundle(db, entries),
    );
    const url = buildBundleUrl(token);

    renderShareLink(bundleLink, url, "handleBundleClick");
    bundleCreate.textContent = "Group link created";

    await copyToClipboard(url, "handleBundleClick");
  } catch {
    // Failure already logged by trackOperation; recover the UI.
    bundleCreate.disabled = false;
    bundleLink.textContent = "Could not create the group link. Try again.";
    bundleLink.hidden = false;
  }
}

// Publish the clicked report as a public capability URL and surface the link
// inside the card. The link keeps working for anyone who has it until the
// share document is deleted (revoked) in Firestore.
//
// Every document the report holds goes into that one link: ticking each
// document into a package first is a chore, and a recipient sent a link to a
// report expects its datasheets and summary alongside it. The package
// checkboxes remain for the narrower job of mixing documents across reports.
export async function handleShareClick(button) {
  const report = allReports.find((entry) => entry.id === button.dataset.reportId);
  if (!report) return;

  const output = button.closest(".report-share")?.querySelector(".share-link");
  const documents = documentsFor(report.id);
  button.disabled = true;

  try {
    // Reports saved before documents were persisted have only themselves to
    // publish, and a lone document reads better as a plain share than as a
    // package of one.
    const token = documents.length > 0
      ? await trackOperation(
        "Publish report package link",
        {
          feature: "PublicShare",
          function: "handleShareClick",
          operation: "firestore.setDoc",
          collection: "docuAlignPublicBundles",
          safeIdentifier: report.id,
        },
        () => publishBundle(
          db,
          documents.map((document) => ({ report, document })),
          { name: report.reportName || report.sourceFileName || null },
        ),
      )
      : await trackOperation(
        "Publish public share link",
        {
          feature: "PublicShare",
          function: "handleShareClick",
          operation: "firestore.setDoc",
          collection: "docuAlignPublicShares",
          safeIdentifier: report.id,
        },
        () => publishReport(db, report),
      );
    const url = documents.length > 0 ? buildBundleUrl(token) : buildPublicUrl(token);

    if (output) renderShareLink(output, url, "handleShareClick");
    button.textContent = "Public link created";

    await copyToClipboard(url, "handleShareClick");
  } catch (error) {
    // Failure already logged by trackOperation; recover the UI. A package that
    // is simply too large needs its own wording, because retrying cannot help.
    button.disabled = false;
    if (output) {
      output.textContent = error instanceof TypeError
        ? error.message
        : "Could not create the public link. Try again.";
      output.hidden = false;
    }
  }
}

// Permanently delete the clicked report. Deletion is destructive, so the button
// is a two-step confirm (arm on the first click, delete on the second) rather
// than a blocking browser confirm() dialog. On success the report is dropped
// from local state, unselected from any group link, and the grid re-rendered.
export async function handleDeleteClick(button) {
  const id = button.dataset.reportId;
  const report = allReports.find((entry) => entry.id === id);
  if (!report) return;

  if (button.dataset.armed !== "true") {
    button.dataset.armed = "true";
    button.textContent = "Confirm delete";
    return;
  }

  button.disabled = true;

  try {
    await trackOperation(
      "Delete report",
      {
        feature: "Dashboard",
        function: "handleDeleteClick",
        operation: "firestore.deleteDoc",
        collection: "docuAlignReports",
        safeIdentifier: id,
      },
      () => deleteReport(db, id),
    );
    allReports = allReports.filter((entry) => entry.id !== id);
    bundleSelection.delete(id);
    render();
  } catch {
    // Failure already logged by trackOperation; recover the UI.
    button.disabled = false;
    button.dataset.armed = "false";
    button.textContent = "Delete";
  }
}

export function render() {
  const filtered = filterReportsByDate(allReports, {
    from: fromInput.value,
    to: toInput.value,
  });

  const hasFilter = Boolean(fromInput.value || toInput.value);

  if (allReports.length === 0) {
    resultCount.textContent = "";
    setStatus("No saved reports yet. Saved reports will appear here.");
    return;
  }

  if (filtered.length === 0) {
    resultCount.textContent = "";
    setStatus(
      hasFilter
        ? "No reports match the selected date range."
        : "No saved reports yet.",
    );
    return;
  }

  resultCount.textContent = hasFilter
    ? `${filtered.length} of ${allReports.length} reports`
    : `${allReports.length} ${allReports.length === 1 ? "report" : "reports"}`;
  grid.innerHTML = filtered.map(reportCard).join("");
  syncBundleSelection();
  setStatus("");
}

export async function loadReports(user) {
  if (loadedForUser === user.uid) return;
  loadedForUser = user.uid;
  setStatus("Loading saved reports…");
  resultCount.textContent = "";

  try {
    allReports = await trackOperation(
      "Load saved reports",
      {
        feature: "Dashboard",
        function: "loadReports",
        operation: "firestore.getDocs",
        collection: "docuAlignReports",
        safeIdentifier: user?.uid ? `uid:${user.uid}` : "anonymous",
      },
      () => fetchReports(db),
    );

    // Load each report's exported documents so any single one can be ticked
    // into a package. A report saved before documents were persisted simply
    // has none, and still shares as a whole.
    const loaded = await trackOperation(
      "Load report documents",
      {
        feature: "Dashboard",
        function: "loadReports",
        operation: "firestore.getDocs",
        collection: "docuAlignReports/documents",
        safeIdentifier: `report-count:${allReports.length}`,
      },
      () =>
        Promise.all(
          allReports.map((report) =>
            fetchReportDocuments(db, report.id).catch((error) => {
              logWarn("Could not load report documents", error, {
                feature: "Dashboard",
                function: "loadReports",
                operation: "firestore.getDocs",
                category: "ReportDocumentLoadFailure",
                safeIdentifier: `report:${report.id}`,
              });
              return [];
            }),
          ),
        ),
    );
    allReports.forEach((report, index) => reportDocuments.set(report.id, loaded[index]));

    render();
  } catch {
    // Failure already logged by trackOperation; recover the UI.
    loadedForUser = null;
    setStatus("Could not load saved reports. Check your connection and try again.");
  }
}

grid.addEventListener("click", (event) => {
  const shareButton = event.target.closest(".share-button");
  if (shareButton) {
    handleShareClick(shareButton);
    return;
  }
  const deleteButton = event.target.closest(".delete-button");
  if (deleteButton) handleDeleteClick(deleteButton);
});

grid.addEventListener("change", (event) => {
  const box = event.target.closest(".bundle-checkbox");
  if (!box) return;
  const key = selectionKey(box.dataset.reportId, box.dataset.documentSlug);
  if (box.checked) {
    bundleSelection.add(key);
  } else {
    bundleSelection.delete(key);
  }
  updateBundleBar();
});

bundleCreate.addEventListener("click", handleBundleClick);

filterForm.addEventListener("input", render);
filterForm.addEventListener("reset", () => {
  // Let the native reset clear the inputs first, then re-render.
  requestAnimationFrame(render);
});

onAuthStateChanged(auth, (user) => {
  if (user) {
    loadReports(user);
  } else {
    allReports = [];
    loadedForUser = null;
    resultCount.textContent = "";
    grid.innerHTML = "";
    setStatus("Sign in to view your saved reports.");
  }
});
