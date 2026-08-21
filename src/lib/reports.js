/**
 * @file reports.js
 * @description Pure domain logic for CRUD operations and client-side date filtering
 * against the `docuAlignReports` Firestore collection. Handles server timestamp
 * stamping and normalization of various timestamp formats into JavaScript Date objects.
 */
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

export const SAVED_REPORTS_COLLECTION = "docuAlignReports";

// Each saved report keeps its exported documents in a subcollection: the test
// report plus every generated worksheet document. A subcollection avoids the
// 1 MiB single-document ceiling, and the existing docuAlignReports/{document=**}
// rule already scopes it to DocuAlign staff.
export const REPORT_DOCUMENTS_COLLECTION = "documents";

// Coerce the various shapes a createdAt value can arrive in (Firestore
// Timestamp, Date, epoch millis, or ISO string) into a plain Date, or null.
export function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value.toDate === "function") return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// The two shapes a filter bound can arrive in: a bare date, and the
// `YYYY-MM-DDTHH:mm` (optionally with seconds) that a datetime-local input
// produces once a time of day is picked.
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
// Split by precision rather than making the seconds optional: one fixed-length
// alternative each keeps the patterns free of the optional group that reads as
// a backtracking risk to the linter, and tells the two cases apart directly.
const DATE_TIME_MINUTES = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const DATE_TIME_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

/**
 * Parse one filter bound into a local Date, or null when it is absent or
 * unparseable.
 *
 * `edge` places the bound at the start or the end of whatever precision the
 * value itself carries, which is what keeps both ends inclusive of the unit the
 * user actually typed. A `to` of `2026-06-30` covers that whole day, and a `to`
 * of `2026-06-30T17:30` covers that whole minute -- without which a report
 * saved at 17:30:45 would fall outside a range the user set to end at 17:30.
 * @param {string} value - Raw input value.
 * @param {"start"|"end"} edge - Which end of the value's own precision to take.
 * @returns {Date|null} The bound, or null.
 */
function parseBound(value, edge) {
  if (!value) return null;
  const text = String(value).trim();
  const end = edge === "end";
  let stamp;

  if (DATE_ONLY.test(text)) {
    stamp = `${text}T${end ? "23:59:59.999" : "00:00:00.000"}`;
  } else if (DATE_TIME_MINUTES.test(text)) {
    // A datetime-local value stops at minutes unless the browser adds seconds.
    stamp = `${text}:${end ? "59.999" : "00.000"}`;
  } else if (DATE_TIME_SECONDS.test(text)) {
    stamp = `${text}.${end ? "999" : "000"}`;
  } else {
    return null;
  }

  const date = new Date(stamp);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Pure, client-side filter so it is easy to test and reuse. `from` and `to` are
// inclusive `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm` strings; either may be omitted
// to leave that bound open. Reports without a usable createdAt are dropped once
// a bound is set.
export function filterReportsByDate(reports, { from, to } = {}) {
  const fromBound = parseBound(from, "start");
  const toBound = parseBound(to, "end");

  if (!fromBound && !toBound) return [...reports];

  return reports.filter((report) => {
    const createdDate = toDate(report.createdAt);
    if (!createdDate) return false;
    if (fromBound && createdDate < fromBound) return false;
    if (toBound && createdDate > toBound) return false;
    return true;
  });
}

// Persist a saved form/report. createdAt is stamped server-side so ordering
// and date filtering are consistent across clients.
export function saveReport(database, report) {
  return addDoc(collection(database, SAVED_REPORTS_COLLECTION), {
    ...report,
    createdAt: serverTimestamp(),
  });
}

// Persist the exported documents belonging to one saved report. Worksheet
// grids are stored as a JSON string because Firestore cannot hold nested
// arrays, and that same string is what a published share carries.
export async function saveReportDocuments(database, reportId, documents) {
  if (!reportId) {
    throw new TypeError("A report id is required to save its documents.");
  }

  await Promise.all(
    documents.map((entry, index) =>
      setDoc(
        doc(database, SAVED_REPORTS_COLLECTION, reportId, REPORT_DOCUMENTS_COLLECTION, entry.slug),
        {
          slug: entry.slug,
          title: entry.title,
          subtitle: entry.subtitle ?? "",
          assetPath: entry.assetPath ?? null,
          data: entry.data ?? null,
          order: index,
        },
      ),
    ),
  );
}

// Load one report's exported documents in their original export order.
export async function fetchReportDocuments(database, reportId) {
  if (!reportId) {
    throw new TypeError("A report id is required to load its documents.");
  }
  const snapshot = await getDocs(
    query(
      collection(database, SAVED_REPORTS_COLLECTION, reportId, REPORT_DOCUMENTS_COLLECTION),
      orderBy("order", "asc"),
    ),
  );
  return snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
}

// Permanently delete one saved form by its Firestore document id. The id is
// required: deleting against an empty path would target the collection itself.
export function deleteReport(database, reportId) {
  if (!reportId) {
    throw new TypeError("A report id is required to delete a saved report.");
  }
  return deleteDoc(doc(database, SAVED_REPORTS_COLLECTION, reportId));
}

// Load all saved forms, newest first, with createdAt normalised to a Date.
export async function fetchReports(database) {
  const reportsQuery = query(
    collection(database, SAVED_REPORTS_COLLECTION),
    orderBy("createdAt", "desc"),
  );
  const snapshot = await getDocs(reportsQuery);
  return snapshot.docs.map((document) => {
    const data = document.data();
    return { id: document.id, ...data, createdAt: toDate(data.createdAt) };
  });
}
