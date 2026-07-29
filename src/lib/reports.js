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

// Parse a YYYY-MM-DD input string into a local Date at the start of that day.
function startOfDay(dateString) {
  if (!dateString) return null;
  const date = new Date(`${dateString}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Parse a YYYY-MM-DD input string into a local Date at the end of that day.
function endOfDay(dateString) {
  if (!dateString) return null;
  const date = new Date(`${dateString}T23:59:59.999`);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Pure, client-side filter so it is easy to test and reuse. `from` and `to`
// are inclusive YYYY-MM-DD strings; either may be omitted to leave that bound
// open. Reports without a usable createdAt are dropped once a bound is set.
export function filterReportsByDate(reports, { from, to } = {}) {
  const fromBound = startOfDay(from);
  const toBound = endOfDay(to);

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
