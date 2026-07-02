/**
 * @file view-report.js
 * @description Controller for the public share viewer (`view.html`). This page is
 * intentionally unauthenticated: the unguessable token in the `share` query
 * parameter is the only credential, and it grants read access to exactly one
 * published report snapshot plus its PDF output. Invalid, revoked, or missing
 * tokens render a status message instead of report data.
 */
import { db } from "./lib/firebase.js";
import { fetchSharedReport, isValidShareToken, PUBLIC_PDF_PATH } from "./lib/share.js";

const status = document.querySelector("#share-status");
const reportPanel = document.querySelector("#share-report");
const reportName = document.querySelector("#share-report-name");
const reportStatus = document.querySelector("#share-report-status");
const reportSource = document.querySelector("#share-source");
const reportPublished = document.querySelector("#share-published");
const pdfLink = document.querySelector("#share-pdf-link");

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
  if (message) {
    status.textContent = message;
    status.hidden = false;
    reportPanel.hidden = true;
  } else {
    status.hidden = true;
    reportPanel.hidden = false;
  }
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
}

/**
 * Resolve the share token from the URL and render the shared report,
 * or an explanatory status message when the link cannot be honoured.
 * @param {string} [search] - Query string override; defaults to the page URL.
 * @returns {Promise<void>} Settles once the viewer has rendered.
 */
export async function initViewer(search = globalThis.location?.search ?? "") {
  const token = getShareTokenFromUrl(search);
  if (!token) {
    setStatus("This share link is not valid. Check the URL and try again.");
    return;
  }

  setStatus("Loading shared report…");

  try {
    const share = await fetchSharedReport(db, token);
    if (!share) {
      setStatus("This share link is no longer available. Ask the report owner for a new link.");
      return;
    }
    renderSharedReport(share);
  } catch (error) {
    setStatus("Could not load this shared report. Check your connection and try again.");
    console.error("[DocuAlign] Failed to load shared report", error, {
      feature: "PublicShare",
      function: "initViewer",
      operation: "firestore.getDoc",
      collection: "docuAlignPublicShares",
      category: error?.code || "DatabaseReadFailure",
    });
  }
}

initViewer();
