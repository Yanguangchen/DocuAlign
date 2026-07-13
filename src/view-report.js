/**
 * @file view-report.js
 * @description Controller for the public share viewer (`view.html`). This page is
 * intentionally unauthenticated: the unguessable token in the `share` query
 * parameter is the only credential, and it grants read access to exactly one
 * published report snapshot plus its PDF output. Invalid, revoked, or missing
 * tokens render a status message instead of report data.
 */
import { db } from "./lib/firebase.js";
import { logWarn, trackOperation } from "./lib/logger.js";
import { initObservability } from "./lib/observability.js";
import {
  fetchSharedBundle,
  fetchSharedReport,
  isValidShareToken,
  PUBLIC_PDF_PATH,
} from "./lib/share.js";

const status = document.querySelector("#share-status");
const reportPanel = document.querySelector("#share-report");
const reportTitle = document.querySelector("#share-report-name");
const reportSubtitle = document.querySelector("#share-report-subtitle");
const reportStatus = document.querySelector("#share-report-status");
const reportReference = document.querySelector("#share-reference");
const reportSourceDetails = document.querySelector("#share-source-details");
const reportSource = document.querySelector("#share-source");
const reportPublished = document.querySelector("#share-published");
const reportSizeRow = document.querySelector("#share-size-row");
const reportSize = document.querySelector("#share-size");
const reportPagesRow = document.querySelector("#share-pages-row");
const reportPages = document.querySelector("#share-pages");
const pdfLink = document.querySelector("#share-pdf-link");
const downloadLink = document.querySelector("#share-download-link");
const previewFrame = document.querySelector("#share-preview-frame");
const previewOverlay = document.querySelector("#share-preview-overlay");
const previewCaption = document.querySelector("#share-preview-caption");

// Shown when the share document carries no extracted title of its own.
const FALLBACK_REPORT_TITLE = "RAK Concrete Test Report";
const bundlePanel = document.querySelector("#share-bundle");
const bundleName = document.querySelector("#share-bundle-name");
const bundleCount = document.querySelector("#share-bundle-count");
const bundlePublished = document.querySelector("#share-bundle-published");
const bundleList = document.querySelector("#share-bundle-list");

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

/**
 * Extract a well-formed share token from a URL query string.
 * @param {string} search - The query string (e.g. `location.search`).
 * @returns {string|null} The token, or null when absent or malformed.
 */
export function getShareTokenFromUrl(search) {
  const token = new URLSearchParams(search).get("share");
  return isValidShareToken(token) ? token : null;
}

/**
 * Extract a well-formed bundle (group link) token from a URL query string.
 * @param {string} search - The query string (e.g. `location.search`).
 * @returns {string|null} The token, or null when absent or malformed.
 */
export function getBundleTokenFromUrl(search) {
  const token = new URLSearchParams(search).get("bundle");
  return isValidShareToken(token) ? token : null;
}

/**
 * Constrain a stored PDF URL to safe destinations. Share documents are written
 * by staff and validated by rules, but the viewer still refuses script/data
 * schemes and protocol-relative URLs, falling back to the bundled report PDF.
 * @param {unknown} url - The pdfUrl field from the share document.
 * @returns {string} A relative path or https URL that is safe to link.
 */
export function safePdfUrl(url) {
  if (typeof url === "string") {
    if (/^[\w][\w./-]*$/.test(url)) return url;
    if (/^https:\/\//.test(url)) return url;
  }
  return PUBLIC_PDF_PATH;
}

/**
 * Recipient-facing wording for each report state. Saved snapshots are complete
 * outputs, so they read as complete; every failure state names a next action
 * instead of relying on a colour-coded badge.
 */
export const SHARE_STATUS_PRESENTATION = new Map([
  ["complete", { icon: "✓", label: "Report complete" }],
  ["saved", { icon: "✓", label: "Report complete" }],
  ["processing", { label: "Processing", hint: "The PDF is still being generated. Check back shortly." }],
  ["expired", { label: "Link expired", hint: "Ask the report owner for a new link." }],
  ["revoked", { label: "Access revoked", hint: "Ask the report owner for a new link." }],
  ["unavailable", { label: "Report unavailable", hint: "Ask the report owner for a new link." }],
  ["failed", { label: "Generation failed", hint: "Ask the report owner to regenerate the report." }],
]);

/**
 * Map a stored report status onto its viewer presentation. Unknown statuses
 * degrade to showing the raw value so nothing is silently hidden.
 * @param {unknown} value - The status field from the share document.
 * @returns {{icon?: string, label: string, hint?: string}} Display descriptor.
 */
export function formatShareStatus(value) {
  const key = typeof value === "string" && value ? value.toLowerCase() : "saved";
  return SHARE_STATUS_PRESENTATION.get(key) ?? { label: key };
}

function renderStatusLine(element, value) {
  const { icon, label, hint } = formatShareStatus(value);
  element.replaceChildren();
  if (icon) {
    const mark = document.createElement("span");
    mark.className = "share-status-check";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = icon;
    element.append(mark);
  }
  const text = document.createElement("strong");
  text.textContent = label;
  element.append(text);
  if (hint) {
    const help = document.createElement("span");
    help.className = "share-status-hint";
    help.textContent = hint;
    element.append(help);
  }
}

/**
 * Format a byte count for the trust section (e.g. "1.8 MB").
 * @param {number} bytes - File size in bytes.
 * @returns {string} Human-readable size.
 */
export function formatFileSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Count the pages of a PDF by scanning its raw bytes for page objects.
 * @param {string} rawPdf - The PDF file decoded as latin1/binary text.
 * @returns {number} Page count, or 0 when none could be identified.
 */
export function countPdfPages(rawPdf) {
  return (rawPdf.match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length;
}

// The share document records neither file size nor page count, so derive both
// from the PDF itself. Each detail only appears when it is genuinely known.
async function loadPdfDetails(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) return;
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > 0) {
      reportSize.textContent = formatFileSize(buffer.byteLength);
      reportSizeRow.hidden = false;
    }
    const pages = countPdfPages(new TextDecoder("latin1").decode(buffer));
    if (pages > 0) {
      reportPages.textContent = `${pages} ${pages === 1 ? "page" : "pages"}`;
      reportPagesRow.hidden = false;
      previewCaption.textContent = `Page 1 of ${pages}`;
    }
  } catch {
    // Details stay hidden; they are a nicety, not a load failure.
  }
}

/**
 * Show a viewer state (loading or error) in place of the report panel.
 * A title makes failure states scannable; the message carries the next action.
 * @param {string} message - Explanation and next action, or "" to clear.
 * @param {string} [title] - Optional short heading for the state.
 */
function setStatus(message, title) {
  status.replaceChildren();
  if (title) {
    const heading = document.createElement("strong");
    heading.textContent = title;
    status.append(heading);
  }
  if (message) {
    const detail = document.createElement("span");
    detail.textContent = message;
    status.append(detail);
  }
  status.hidden = !message;
  reportPanel.hidden = true;
  bundlePanel.hidden = true;
}

function renderSharedReport(share) {
  reportTitle.textContent = share.reportTitle || FALLBACK_REPORT_TITLE;
  const subtitle = [share.clientName, share.jobRef ? `Job reference ${share.jobRef}` : null]
    .filter(Boolean)
    .join(" · ");
  reportSubtitle.textContent = subtitle;
  reportSubtitle.hidden = !subtitle;
  reportReference.textContent = share.reportName || "Untitled report";
  renderStatusLine(reportStatus, share.status);
  reportSourceDetails.hidden = !share.sourceFileName;
  reportSource.textContent = share.sourceFileName
    ? `Source spreadsheet: ${share.sourceFileName}`
    : "";
  reportPublished.textContent = share.publishedAt
    ? dateFormatter.format(share.publishedAt)
    : "Date unavailable";
  const pdfUrl = safePdfUrl(share.pdfUrl);
  pdfLink.setAttribute("href", pdfUrl);
  downloadLink.setAttribute("href", pdfUrl);
  previewOverlay.setAttribute("href", pdfUrl);
  // Ask the browser's PDF viewer for a clean first-page render.
  previewFrame.setAttribute("src", `${pdfUrl}#page=1&toolbar=0&navpanes=0&scrollbar=0`);
  loadPdfDetails(pdfUrl);
  setStatus("");
  reportPanel.hidden = false;
}

// Build each grouped report entry with DOM APIs (not innerHTML) so report
// names and file names from the share document can never inject markup.
function bundleReportItem(report) {
  const item = document.createElement("li");
  item.className = "bundle-report";

  const head = document.createElement("div");
  head.className = "report-card-head";
  const title = document.createElement("strong");
  title.textContent = report.reportName || "Untitled report";
  const statusLabel = document.createElement("span");
  statusLabel.className = "report-status";
  statusLabel.textContent = formatShareStatus(report.status).label;
  head.append(title, statusLabel);
  item.append(head);

  if (report.sourceFileName) {
    const source = document.createElement("p");
    source.className = "report-source";
    source.textContent = `Source: ${report.sourceFileName}`;
    item.append(source);
  }

  const anchor = document.createElement("a");
  anchor.className = "google-button share-pdf-button";
  anchor.href = safePdfUrl(report.pdfUrl);
  anchor.target = "_blank";
  anchor.rel = "noopener";
  anchor.textContent = "View report";
  item.append(anchor);

  return item;
}

function renderSharedBundle(sharedBundle) {
  bundleName.textContent = sharedBundle.bundleName || "Shared reports";
  bundleCount.textContent = `${sharedBundle.reports.length} ${
    sharedBundle.reports.length === 1 ? "report" : "reports"
  }`;
  bundlePublished.textContent = sharedBundle.publishedAt
    ? dateFormatter.format(sharedBundle.publishedAt)
    : "Date unavailable";
  bundleList.replaceChildren(...sharedBundle.reports.map(bundleReportItem));
  setStatus("");
  bundlePanel.hidden = false;
}

/**
 * Resolve the share token from the URL and render the shared report,
 * or an explanatory status message when the link cannot be honoured.
 * @param {string} [search] - Query string override; defaults to the page URL.
 * @returns {Promise<void>} Settles once the viewer has rendered.
 */
export async function initViewer(search = globalThis.location?.search ?? "") {
  const bundleToken = getBundleTokenFromUrl(search);
  const shareToken = getShareTokenFromUrl(search);
  if (!bundleToken && !shareToken) {
    setStatus("This share link is not valid. Check the URL and try again.", "Link not valid");
    logWarn("Share link rejected: missing or malformed token", {
      feature: "PublicShare",
      function: "initViewer",
      operation: "validateShareToken",
      category: "InvalidShareLink",
    });
    return;
  }

  setStatus("Loading shared report…");

  if (bundleToken) {
    try {
      const sharedBundle = await trackOperation(
        "Load shared bundle",
        {
          feature: "PublicShare",
          function: "initViewer",
          operation: "firestore.getDoc",
          collection: "docuAlignPublicBundles",
        },
        () => fetchSharedBundle(db, bundleToken),
      );
      if (!sharedBundle) {
        setStatus(
          "This share link is no longer available. Ask the report owner for a new link.",
          "Report unavailable",
        );
        return;
      }
      renderSharedBundle(sharedBundle);
    } catch {
      // Failure already logged by trackOperation; show the recovery message.
      setStatus(
        "Could not load this shared report. Check your connection and try again.",
        "Something went wrong",
      );
    }
    return;
  }

  try {
    const share = await trackOperation(
      "Load shared report",
      {
        feature: "PublicShare",
        function: "initViewer",
        operation: "firestore.getDoc",
        collection: "docuAlignPublicShares",
      },
      () => fetchSharedReport(db, shareToken),
    );
    if (!share) {
      setStatus(
        "This share link is no longer available. Ask the report owner for a new link.",
        "Report unavailable",
      );
      return;
    }
    renderSharedReport(share);
  } catch {
    // Failure already logged by trackOperation; show the recovery message.
    setStatus("Could not load this shared report. Check your connection and try again.");
  }
}

initObservability();
initViewer();
