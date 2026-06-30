import {
  addDoc,
  collection,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore";

export const SAVED_REPORTS_COLLECTION = "docuAlignReports";

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
