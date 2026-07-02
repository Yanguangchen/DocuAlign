/**
 * @file dashboard.js
 * @description Controller logic for the saved reports cloud dashboard (`dashboard.html`).
 * Fetches all persisted reports from Firestore upon authentication, renders interactive
 * report cards, and provides real-time date filtering and status feedback.
 */
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "./lib/firebase.js";
import { fetchReports, filterReportsByDate } from "./lib/reports.js";
import { buildPublicUrl, publishReport } from "./lib/share.js";

const filterForm = document.querySelector("#date-filter");
const fromInput = document.querySelector("#filter-from");
const toInput = document.querySelector("#filter-to");
const status = document.querySelector("#dashboard-status");
const grid = document.querySelector("#report-grid");
const resultCount = document.querySelector("#result-count");

let allReports = [];
let loadedForUser = null;

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
        <p class="share-link" aria-live="polite" hidden></p>
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

// Publish the clicked report as a public capability URL and surface the link
// inside the card. The link keeps working for anyone who has it until the
// share document is deleted (revoked) in Firestore.
export async function handleShareClick(button) {
  const report = allReports.find((entry) => entry.id === button.dataset.reportId);
  if (!report) return;

  const output = button.closest(".report-share")?.querySelector(".share-link");
  button.disabled = true;

  try {
    const token = await publishReport(db, report);
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

    if (navigator.clipboard?.writeText) {
      // Best effort: surfacing the link matters, the copy is a convenience.
      await navigator.clipboard.writeText(url).catch(() => {});
    }
  } catch (error) {
    button.disabled = false;
    if (output) {
      output.textContent = "Could not create the public link. Try again.";
      output.hidden = false;
    }
    console.error("[DocuAlign] Failed to publish public share link", error, {
      feature: "PublicShare",
      function: "handleShareClick",
      operation: "firestore.setDoc",
      collection: "docuAlignPublicShares",
      safeIdentifier: button.dataset.reportId,
      category: error?.code || "DatabaseWriteFailure",
    });
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
  setStatus("");
}

export async function loadReports(user) {
  if (loadedForUser === user.uid) return;
  loadedForUser = user.uid;
  setStatus("Loading saved reports…");
  resultCount.textContent = "";

  try {
    allReports = await fetchReports(db);
    render();
  } catch (error) {
    loadedForUser = null;
    setStatus("Could not load saved reports. Check your connection and try again.");
    console.error("[DocuAlign] Failed to load saved reports", error, {
      feature: "Dashboard",
      function: "loadReports",
      operation: "firestore.getDocs",
      collection: "docuAlignReports",
      category: error?.code || "DatabaseReadFailure",
      safeIdentifier: user?.uid ? `uid:${user.uid}` : "anonymous",
    });
  }
}

grid.addEventListener("click", (event) => {
  const button = event.target.closest(".share-button");
  if (button) handleShareClick(button);
});

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
