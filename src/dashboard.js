/**
 * @file dashboard.js
 * @description Controller logic for the saved reports cloud dashboard (`dashboard.html`).
 * Fetches all persisted reports from Firestore upon authentication, renders interactive
 * report cards, and provides real-time date filtering and status feedback.
 */
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "./lib/firebase.js";
import { fetchReports, filterReportsByDate } from "./lib/reports.js";

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
    </li>
  `;
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
