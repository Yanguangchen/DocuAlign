/**
 * @file dashboard.js
 * @description Controller logic for the saved reports cloud dashboard (`dashboard.html`).
 * Fetches all persisted reports from Firestore upon authentication, renders interactive
 * report cards, and provides real-time date filtering and status feedback.
 */
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "./lib/firebase.js";
import { deleteReport, fetchReports, filterReportsByDate } from "./lib/reports.js";
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
// Report ids ticked for grouping into one link; survives re-renders.
const bundleSelection = new Set();

async function copyToClipboard(url, caller) {
  if (!navigator.clipboard?.writeText) return;

  try {
    await navigator.clipboard.writeText(url);
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
  }
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
  const share = report.id
    ? `
      <div class="report-share">
        <button class="share-button" type="button" data-report-id="${escapeHtml(report.id)}">
          Create public link
        </button>
        <label class="bundle-select">
          <input
            type="checkbox"
            class="bundle-checkbox"
            data-report-id="${escapeHtml(report.id)}"
          />
          Add to group link
        </label>
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
  bundleCount.textContent = `${count} ${count === 1 ? "report" : "reports"} selected`;
  bundleCreate.disabled = false;
  bundleCreate.textContent = "Create group link";
  bundleLink.hidden = true;
}

// Re-rendering rebuilds the card DOM, so restore each checkbox from the
// selection set and drop ids whose cards are no longer in the grid (e.g.
// filtered out by the date range).
function syncBundleSelection() {
  const boxes = [...grid.querySelectorAll(".bundle-checkbox")];
  const visible = new Set(boxes.map((box) => box.dataset.reportId));
  for (const id of bundleSelection) {
    if (!visible.has(id)) bundleSelection.delete(id);
  }
  for (const box of boxes) {
    box.checked = bundleSelection.has(box.dataset.reportId);
  }
  updateBundleBar();
}

// Publish every selected report behind one group URL: each report becomes an
// ordinary public share, and the bundle document ties their tokens together
// so the customer sees all grouped PDF exports on a single page.
export async function handleBundleClick() {
  const reports = allReports.filter((report) => bundleSelection.has(report.id));
  if (reports.length === 0) return;

  bundleCreate.disabled = true;

  try {
    const token = await trackOperation(
      "Publish group link",
      {
        feature: "PublicShare",
        function: "handleBundleClick",
        operation: "firestore.setDoc",
        collection: "docuAlignPublicBundles",
        safeIdentifier: `selection:${reports.length}`,
      },
      () => publishBundle(db, reports),
    );
    const url = buildBundleUrl(token);

    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.target = "_blank";
    anchor.rel = "noopener";
    anchor.textContent = url;
    bundleLink.replaceChildren(anchor);
    bundleLink.hidden = false;
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
export async function handleShareClick(button) {
  const report = allReports.find((entry) => entry.id === button.dataset.reportId);
  if (!report) return;

  const output = button.closest(".report-share")?.querySelector(".share-link");
  button.disabled = true;

  try {
    const token = await trackOperation(
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
    const url = buildPublicUrl(token);

    if (output) {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.target = "_blank";
      anchor.rel = "noopener";
      anchor.textContent = url;
      output.replaceChildren(anchor);
      output.hidden = false;
    }
    button.textContent = "Public link created";

    await copyToClipboard(url, "handleShareClick");
  } catch {
    // Failure already logged by trackOperation; recover the UI.
    button.disabled = false;
    if (output) {
      output.textContent = "Could not create the public link. Try again.";
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
  if (box.checked) {
    bundleSelection.add(box.dataset.reportId);
  } else {
    bundleSelection.delete(box.dataset.reportId);
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
