/**
 * @file share.js
 * @description Pure domain logic for public report share links. Publishing a saved
 * report writes a sanitised, PII-free snapshot into the `docuAlignPublicShares`
 * collection keyed by an unguessable capability token. Anyone holding the resulting
 * URL can read that one share document (Firestore rules allow `get` but never `list`)
 * and open the PDF output tied to it — no other report data is reachable.
 */
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { toDate } from "./reports.js";

export const PUBLIC_SHARES_COLLECTION = "docuAlignPublicShares";

// Grouped share links ("bundles"): one capability token exposing several
// report snapshots at once, so a customer opens a single URL and sees every
// PDF export grouped for them. Same security model as single shares.
export const PUBLIC_BUNDLES_COLLECTION = "docuAlignPublicBundles";

// Upper bound on documents per package; mirrored by the Firestore rules so an
// oversized group is rejected on both sides of the trust boundary.
//
// A saved report expands to roughly seven documents, so the previous cap of 25
// stopped staff at four reports per package -- the ceiling was set by how
// expensive the rules were to evaluate, not by anything about the product.
//
// The rules now validate the token list at constant cost (see
// isValidDocuAlignBundleTokens in firestore.rules): 10,000 members were
// measured to validate as fast as 250, so the rules no longer bound this at
// all. What bounds it now is downstream of the write -- publishing fires one
// Firestore write per document, and the viewer then reads one document per
// member, rebuilds every PDF in the browser, and holds them all in memory to
// build the ZIP. 250 is ~35 saved reports, which keeps that page comfortable;
// raising it further is a question about the customer's browser, not Firestore.
export const MAX_BUNDLE_REPORTS = 250;

// Upper bound on a published document's serialised worksheet data. Generated
// documents (summary, coral + org, DS1, SB1) travel inside the share document
// as one JSON string so the public viewer can rebuild the PDF locally; capping
// the length keeps the share well inside Firestore's 1 MiB document limit and
// costs the rules a single expression to validate.
export const MAX_DOCUMENT_DATA_LENGTH = 100000;

// The PDF output asset the public viewer serves for a shared report. Relative so
// it resolves against the deployed origin (see the dual asset directory contract).
export const PUBLIC_PDF_PATH = "SampleDocuments/SampleOutput.pdf";

// 32 alphanumeric characters ≈ 190 bits of entropy: the token IS the access
// secret, so it must be unguessable and URL-safe without percent-encoding.
export const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9]{32}$/;

const TOKEN_LENGTH = 32;
const TOKEN_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/**
 * Generate a cryptographically random, URL-safe share token.
 * Rejection sampling keeps every alphabet character equally likely.
 * @returns {string} A 32 character alphanumeric capability token.
 */
export function generateShareToken() {
  // Largest multiple of the alphabet size below 256; bytes at or above it are
  // discarded so the modulo step cannot bias early alphabet characters.
  const unbiasedLimit = 256 - (256 % TOKEN_ALPHABET.length);
  let token = "";
  while (token.length < TOKEN_LENGTH) {
    const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_LENGTH * 2));
    for (const byte of bytes) {
      if (token.length === TOKEN_LENGTH) break;
      if (byte < unbiasedLimit) {
        token += TOKEN_ALPHABET.charAt(byte % TOKEN_ALPHABET.length);
      }
    }
  }
  return token;
}

/**
 * Check whether a value is a well-formed share token.
 * @param {unknown} token - Candidate token from a URL or caller.
 * @returns {boolean} True only for 32 character alphanumeric strings.
 */
export function isValidShareToken(token) {
  return typeof token === "string" && SHARE_TOKEN_PATTERN.test(token);
}

/**
 * Build the public viewer URL for a share token, resolved against the current
 * page so subdirectory deployments keep working.
 * @param {string} token - A valid share token.
 * @param {string} [baseUrl] - URL to resolve against; defaults to the current page.
 * @returns {string} Absolute URL of the public viewer for this share.
 */
export function buildPublicUrl(token, baseUrl = globalThis.location?.href) {
  if (!isValidShareToken(token)) {
    throw new TypeError("A valid share token is required to build a public URL.");
  }
  const url = new URL("view.html", baseUrl);
  url.search = `?share=${token}`;
  return url.toString();
}

/**
 * Build the public viewer URL for a bundle token.
 * @param {string} token - A valid share token.
 * @param {string} [baseUrl] - URL to resolve against; defaults to the current page.
 * @returns {string} Absolute URL of the public viewer for this bundle.
 */
export function buildBundleUrl(token, baseUrl = globalThis.location?.href) {
  if (!isValidShareToken(token)) {
    throw new TypeError("A valid share token is required to build a bundle URL.");
  }
  const url = new URL("view.html", baseUrl);
  url.search = `?bundle=${token}`;
  return url.toString();
}

/**
 * Reduce a saved report to the fields that are safe to expose publicly.
 * Deliberately excludes createdBy (staff email) and any unknown fields.
 * @param {Object} report - A saved report as returned by fetchReports.
 * @returns {Object} Sanitised snapshot for the public share document.
 */
export function toPublicReportPayload(report) {
  return {
    reportId: report.id,
    reportName: report.reportName || report.sourceFileName || "Untitled report",
    sourceFileName: report.sourceFileName ?? null,
    status: report.status || "saved",
    pdfUrl: PUBLIC_PDF_PATH,
  };
}

/**
 * Publish a saved report as a public share document keyed by a fresh token.
 * publishedAt is stamped server-side for a consistent audit trail.
 * @param {Object} database - Firestore database instance.
 * @param {Object} report - A saved report (must carry its Firestore document id).
 * @returns {Promise<string>} The share token backing the public URL.
 */
export async function publishReport(database, report) {
  return publishDocument(database, report, null);
}

/**
 * Reduce one of a report's documents to a publicly shareable snapshot.
 *
 * The fixed-format test report is served from its static asset via `pdfUrl`
 * and carries no data. Every other document (summary, coral + org, DS1, SB1)
 * travels as serialised worksheet data the viewer rebuilds into a PDF.
 * @param {Object} report - The saved report the document belongs to.
 * @param {Object|null} documentRecord - The document, or null for the report itself.
 * @returns {Object} Sanitised snapshot for the public share document.
 */
export function toPublicDocumentPayload(report, documentRecord) {
  const payload = toPublicReportPayload(report);
  if (!documentRecord) return payload;

  const data = documentRecord.data ?? null;
  if (data !== null && data.length > MAX_DOCUMENT_DATA_LENGTH) {
    throw new TypeError("This document is too large to publish as a public link.");
  }

  return {
    ...payload,
    reportName: documentRecord.title || payload.reportName,
    documentSlug: documentRecord.slug ?? null,
    // Asset-backed documents keep pdfUrl and publish no data.
    documentData: documentRecord.assetPath ? null : data,
  };
}

/**
 * Publish one document of a saved report as a public share document.
 * @param {Object} database - Firestore database instance.
 * @param {Object} report - A saved report (must carry its Firestore document id).
 * @param {Object|null} [documentRecord] - The document to publish, or null for the report.
 * @returns {Promise<string>} The share token backing the public URL.
 */
export async function publishDocument(database, report, documentRecord = null) {
  if (!report?.id) {
    throw new TypeError("Only reports saved to the cloud can be shared publicly.");
  }
  const token = generateShareToken();
  await setDoc(doc(database, PUBLIC_SHARES_COLLECTION, token), {
    ...toPublicDocumentPayload(report, documentRecord),
    publishedAt: serverTimestamp(),
  });
  return token;
}

/**
 * Publish a group of saved reports as one public bundle URL. Each report is
 * published as an ordinary single share first, and the bundle document only
 * stores the resulting share tokens. This keeps every grouped report
 * individually revocable and keeps the bundle rules cheap to evaluate
 * (Firestore rules cap each evaluation at 1000 expressions, which embedded
 * per-report snapshots would exceed).
 * @param {Object} database - Firestore database instance.
 * @param {Array<Object>} reports - Saved reports to group (1..MAX_BUNDLE_REPORTS).
 * @param {{ name?: string }} [options] - Optional customer-facing bundle title.
 * @returns {Promise<string>} The share token backing the public bundle URL.
 */
export async function publishBundle(database, entries, { name } = {}) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new TypeError("Select at least one document to group into a package.");
  }
  if (entries.length > MAX_BUNDLE_REPORTS) {
    throw new TypeError(`A package can hold at most ${MAX_BUNDLE_REPORTS} documents.`);
  }
  // Entries are either a saved report or a { report, document } pair, so a
  // package can mix test reports with their datasheets and summary sheets.
  const normalised = entries.map((entry) =>
    entry?.report ? entry : { report: entry, document: null },
  );
  if (normalised.some(({ report }) => !report?.id)) {
    throw new TypeError("Only documents saved to the cloud can be grouped into a package.");
  }

  const shareTokens = await Promise.all(
    normalised.map(({ report, document }) => publishDocument(database, report, document)),
  );

  const token = generateShareToken();
  await setDoc(doc(database, PUBLIC_BUNDLES_COLLECTION, token), {
    bundleName: name ?? null,
    shareTokens,
    publishedAt: serverTimestamp(),
  });
  return token;
}

/**
 * Load one public bundle by token and resolve every linked share into its
 * report snapshot. Invalid tokens and missing bundles resolve to null; shares
 * that were revoked (deleted) since publication are silently dropped, and a
 * malformed shareTokens field degrades to an empty report list.
 * @param {Object} database - Firestore database instance.
 * @param {unknown} token - Bundle token taken from the viewer URL.
 * @returns {Promise<Object|null>} Bundle with `reports` resolved and a
 *   normalised publishedAt Date.
 */
export async function fetchSharedBundle(database, token) {
  if (!isValidShareToken(token)) return null;
  const snapshot = await getDoc(doc(database, PUBLIC_BUNDLES_COLLECTION, token));
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  const shareTokens = Array.isArray(data.shareTokens) ? data.shareTokens : [];
  const shares = await Promise.all(
    shareTokens.map((shareToken) => fetchSharedReport(database, shareToken)),
  );
  return {
    token,
    bundleName: data.bundleName ?? null,
    reports: shares.filter(Boolean),
    publishedAt: toDate(data.publishedAt),
  };
}

/**
 * Load one public share by token. Invalid tokens short-circuit to null without
 * a Firestore round trip; missing documents also resolve to null.
 * @param {Object} database - Firestore database instance.
 * @param {unknown} token - Share token taken from the viewer URL.
 * @returns {Promise<Object|null>} The share with a normalised publishedAt Date.
 */
export async function fetchSharedReport(database, token) {
  if (!isValidShareToken(token)) return null;
  const snapshot = await getDoc(doc(database, PUBLIC_SHARES_COLLECTION, token));
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  return { token, ...data, publishedAt: toDate(data.publishedAt) };
}
