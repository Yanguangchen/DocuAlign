import { describe, it, expect, vi } from "vitest";
import { filterReportsByDate, toDate, saveReport, fetchReports, SAVED_REPORTS_COLLECTION } from "./reports.js";
import * as firestore from "firebase/firestore";

vi.mock("firebase/firestore", () => ({
  addDoc: vi.fn(),
  collection: vi.fn((db, name) => ({ db, name })),
  getDocs: vi.fn(),
  orderBy: vi.fn((field, dir) => ({ field, dir })),
  query: vi.fn((coll, order) => ({ coll, order })),
  serverTimestamp: vi.fn(() => "MOCK_TIMESTAMP"),
}));

function report(id, createdAt) {
  return { id, reportName: id, createdAt };
}

describe("toDate", () => {
  it("passes Date instances through", () => {
    const date = new Date("2026-06-15T10:00:00");
    expect(toDate(date)).toBe(date);
  });

  it("converts Firestore Timestamp-like values via toDate()", () => {
    const date = new Date("2026-06-15T10:00:00");
    expect(toDate({ toDate: () => date })).toBe(date);
  });

  it("parses ISO strings and epoch millis", () => {
    expect(toDate("2026-06-15T10:00:00").getFullYear()).toBe(2026);
    expect(toDate(1700000000000)).toBeInstanceOf(Date);
  });

  it("returns null for missing or invalid values", () => {
    expect(toDate(null)).toBeNull();
    expect(toDate(undefined)).toBeNull();
    expect(toDate("not-a-date")).toBeNull();
    expect(toDate(new Date("nope"))).toBeNull();
  });
});

describe("filterReportsByDate", () => {
  const reports = [
    report("jan", new Date("2026-01-10T09:00:00")),
    report("jun-start", new Date("2026-06-01T00:00:00")),
    report("jun-mid", new Date("2026-06-15T14:30:00")),
    report("jun-end", new Date("2026-06-30T23:59:00")),
    report("dec", new Date("2026-12-25T12:00:00")),
  ];

  it("returns a copy of all reports when no bounds are set", () => {
    const result = filterReportsByDate(reports, {});
    expect(result).toHaveLength(reports.length);
    expect(result).not.toBe(reports);
  });

  it("returns all reports when called with no options", () => {
    expect(filterReportsByDate(reports)).toHaveLength(reports.length);
  });

  it("filters with an inclusive from bound (start of day)", () => {
    const result = filterReportsByDate(reports, { from: "2026-06-01" });
    expect(result.map((r) => r.id)).toEqual(["jun-start", "jun-mid", "jun-end", "dec"]);
  });

  it("filters with an inclusive to bound (end of day)", () => {
    const result = filterReportsByDate(reports, { to: "2026-06-30" });
    expect(result.map((r) => r.id)).toEqual(["jan", "jun-start", "jun-mid", "jun-end"]);
  });

  it("filters with a from/to range, inclusive on both ends", () => {
    const result = filterReportsByDate(reports, { from: "2026-06-01", to: "2026-06-30" });
    expect(result.map((r) => r.id)).toEqual(["jun-start", "jun-mid", "jun-end"]);
  });

  it("returns nothing when the range excludes everything", () => {
    expect(filterReportsByDate(reports, { from: "2027-01-01" })).toHaveLength(0);
  });

  it("drops reports without a usable createdAt once a bound is set", () => {
    const withMissing = [...reports, report("orphan", null)];
    const result = filterReportsByDate(withMissing, { from: "2026-01-01" });
    expect(result.map((r) => r.id)).not.toContain("orphan");
  });

  it("normalises Firestore Timestamp-like createdAt values", () => {
    const stamped = [report("ts", { toDate: () => new Date("2026-06-15T10:00:00") })];
    expect(filterReportsByDate(stamped, { from: "2026-06-10", to: "2026-06-20" })).toHaveLength(1);
  });
});

describe("saveReport", () => {
  it("saves report with serverTimestamp to docuAlignReports collection", async () => {
    firestore.addDoc.mockResolvedValueOnce({ id: "doc-123" });
    const dummyDb = {};
    const reportData = { title: "Lab Report A" };
    const result = await saveReport(dummyDb, reportData);
    expect(firestore.collection).toHaveBeenCalledWith(dummyDb, SAVED_REPORTS_COLLECTION);
    expect(firestore.addDoc).toHaveBeenCalledWith({ db: dummyDb, name: SAVED_REPORTS_COLLECTION }, {
      title: "Lab Report A",
      createdAt: "MOCK_TIMESTAMP"
    });
    expect(result).toEqual({ id: "doc-123" });
  });
});

describe("fetchReports", () => {
  it("queries reports ordered by createdAt desc and normalises dates", async () => {
    const dummyDb = {};
    const mockSnapshot = {
      docs: [
        { id: "1", data: () => ({ title: "Rep 1", createdAt: "2026-06-15T10:00:00" }) },
        { id: "2", data: () => ({ title: "Rep 2", createdAt: null }) }
      ]
    };
    firestore.getDocs.mockResolvedValueOnce(mockSnapshot);

    const reports = await fetchReports(dummyDb);
    expect(firestore.collection).toHaveBeenCalledWith(dummyDb, SAVED_REPORTS_COLLECTION);
    expect(firestore.orderBy).toHaveBeenCalledWith("createdAt", "desc");
    expect(reports).toHaveLength(2);
    expect(reports[0]).toEqual({ id: "1", title: "Rep 1", createdAt: new Date("2026-06-15T10:00:00") });
    expect(reports[1]).toEqual({ id: "2", title: "Rep 2", createdAt: null });
  });
});
