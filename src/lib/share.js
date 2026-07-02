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
  if (!report?.id) {
    throw new TypeError("Only reports saved to the cloud can be shared publicly.");
  }
  const token = generateShareToken();
  await setDoc(doc(database, PUBLIC_SHARES_COLLECTION, token), {
    ...toPublicReportPayload(report),
    publishedAt: serverTimestamp(),
  });
  return token;
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
