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
const reportName = document.querySelector("#share-report-name");
const reportStatus = document.querySelector("#share-report-status");
const reportSource = document.querySelector("#share-source");
const reportPublished = document.querySelector("#share-published");
const pdfLink = document.querySelector("#share-pdf-link");
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

function setStatus(message) {
  if (message) status.textContent = message;
  status.hidden = !message;
  reportPanel.hidden = true;
  bundlePanel.hidden = true;
}

function renderSharedReport(share) {
  reportName.textContent = share.reportName || "Untitled report";
  reportStatus.textContent = share.status || "saved";
  reportSource.textContent = share.sourceFileName ? `Source: ${share.sourceFileName}` : "";
  reportPublished.textContent = share.publishedAt
    ? dateFormatter.format(share.publishedAt)
    : "Date unavailable";
  pdfLink.setAttribute("href", safePdfUrl(share.pdfUrl));
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
  statusLabel.textContent = report.status || "saved";
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
  anchor.textContent = "Open PDF report";
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
    setStatus("This share link is not valid. Check the URL and try again.");
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
        setStatus("This share link is no longer available. Ask the report owner for a new link.");
        return;
      }
      renderSharedBundle(sharedBundle);
    } catch {
      // Failure already logged by trackOperation; show the recovery message.
      setStatus("Could not load this shared report. Check your connection and try again.");
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
      setStatus("This share link is no longer available. Ask the report owner for a new link.");
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
