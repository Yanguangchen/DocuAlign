import { describe, it, expect, vi } from "vitest";
import {
  dayRange,
  filterReportsByDate,
  monthRange,
  toDate,
  saveReport,
  saveReportDocuments,
  fetchReports,
  fetchReportDocuments,
  deleteReport,
  SAVED_REPORTS_COLLECTION,
  REPORT_DOCUMENTS_COLLECTION,
} from "./reports.js";
import * as firestore from "firebase/firestore";

vi.mock("firebase/firestore", () => ({
  addDoc: vi.fn(),
  collection: vi.fn((db, ...path) => ({ db, name: path.join("/") })),
  deleteDoc: vi.fn(),
  doc: vi.fn((db, ...path) => ({ db, name: path.slice(0, -1).join("/"), id: path.at(-1) })),
  getDocs: vi.fn(),
  orderBy: vi.fn((field, dir) => ({ field, dir })),
  query: vi.fn((coll, order) => ({ coll, order })),
  serverTimestamp: vi.fn(() => "MOCK_TIMESTAMP"),
  setDoc: vi.fn(),
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

describe("dayRange", () => {
  it("covers a whole single day", () => {
    expect(dayRange(new Date(2026, 5, 15, 14, 30))).toEqual({
      from: "2026-06-15",
      to: "2026-06-15",
    });
  });

  it("reads the day in local time, not UTC", () => {
    // 00:30 local on the 15th is still the 14th in UTC anywhere east of it.
    // Formatting via toISOString would report the wrong day and drop every
    // report saved before the UTC offset each morning.
    expect(dayRange(new Date(2026, 5, 15, 0, 30)).from).toBe("2026-06-15");
    expect(dayRange(new Date(2026, 5, 15, 23, 30)).to).toBe("2026-06-15");
  });

  it("defaults to today", () => {
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    expect(dayRange()).toEqual({ from: expected, to: expected });
  });

  it("bounds a day inclusively once run through the filter", () => {
    const sameDay = [
      report("start", new Date(2026, 5, 15, 0, 0, 0)),
      report("end", new Date(2026, 5, 15, 23, 59, 59)),
      report("next", new Date(2026, 5, 16, 0, 0, 0)),
    ];
    expect(
      filterReportsByDate(sameDay, dayRange(new Date(2026, 5, 15))).map((r) => r.id),
    ).toEqual(["start", "end"]);
  });
});

describe("monthRange", () => {
  it("covers a whole 30-day month", () => {
    expect(monthRange("2026-06")).toEqual({ from: "2026-06-01", to: "2026-06-30" });
  });

  it("covers a whole 31-day month", () => {
    expect(monthRange("2026-07")).toEqual({ from: "2026-07-01", to: "2026-07-31" });
  });

  it("gets February right in a common year and a leap year", () => {
    expect(monthRange("2026-02").to).toBe("2026-02-28");
    expect(monthRange("2028-02").to).toBe("2028-02-29");
  });

  it("covers December without rolling into the next year", () => {
    expect(monthRange("2026-12")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });

  it("rejects a missing or malformed month", () => {
    expect(monthRange("")).toBeNull();
    expect(monthRange(null)).toBeNull();
    expect(monthRange(undefined)).toBeNull();
    expect(monthRange("2026")).toBeNull();
    expect(monthRange("2026-6")).toBeNull();
    expect(monthRange("2026-06-01")).toBeNull();
    expect(monthRange("2026-13")).toBeNull();
    expect(monthRange("2026-00")).toBeNull();
  });

  it("bounds a month inclusively once run through the filter", () => {
    const spanning = [
      report("may-end", new Date(2026, 4, 31, 23, 59)),
      report("jun-start", new Date(2026, 5, 1, 0, 0)),
      report("jun-end", new Date(2026, 5, 30, 23, 59)),
      report("jul-start", new Date(2026, 6, 1, 0, 0)),
    ];
    expect(
      filterReportsByDate(spanning, monthRange("2026-06")).map((r) => r.id),
    ).toEqual(["jun-start", "jun-end"]);
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

  it("accepts a date-time bound and filters to the minute", () => {
    // The datetime-local shape the dashboard's From/To inputs now produce.
    const result = filterReportsByDate(reports, {
      from: "2026-06-01T00:00",
      to: "2026-06-15T14:30",
    });
    expect(result.map((r) => r.id)).toEqual(["jun-start", "jun-mid"]);
  });

  it("keeps a date-time bound inclusive of the minute the user typed", () => {
    // jun-mid was saved at 14:30:00. A `to` of 14:30 must include the whole
    // minute, and a `from` of 14:31 must fall past it.
    expect(
      filterReportsByDate(reports, { to: "2026-06-15T14:30" }).map((r) => r.id),
    ).toEqual(["jan", "jun-start", "jun-mid"]);
    expect(
      filterReportsByDate(reports, { from: "2026-06-15T14:31" }).map((r) => r.id),
    ).toEqual(["jun-end", "dec"]);
  });

  it("accepts a seconds-precision bound", () => {
    const seconds = [report("early", new Date("2026-06-15T14:30:29"))].concat(
      report("late", new Date("2026-06-15T14:30:31")),
    );
    expect(
      filterReportsByDate(seconds, { to: "2026-06-15T14:30:30" }).map((r) => r.id),
    ).toEqual(["early"]);
  });

  it("ignores a bound it cannot parse, leaving that end open", () => {
    expect(filterReportsByDate(reports, { from: "not-a-date" })).toHaveLength(
      reports.length,
    );
    expect(filterReportsByDate(reports, { from: "2026-6-1" })).toHaveLength(
      reports.length,
    );
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

  it("handles invalid date strings in bounds gracefully returning null bounds", () => {
    const result = filterReportsByDate(reports, { from: "invalid-date", to: "invalid-date" });
    expect(result).toHaveLength(reports.length);
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

describe("deleteReport", () => {
  it("deletes the report document by id from the docuAlignReports collection", async () => {
    firestore.deleteDoc.mockResolvedValueOnce(undefined);
    const dummyDb = {};
    const result = await deleteReport(dummyDb, "doc-123");
    expect(firestore.doc).toHaveBeenCalledWith(dummyDb, SAVED_REPORTS_COLLECTION, "doc-123");
    expect(firestore.deleteDoc).toHaveBeenCalledWith({
      db: dummyDb,
      name: SAVED_REPORTS_COLLECTION,
      id: "doc-123",
    });
    expect(result).toBeUndefined();
  });

  it("throws when no report id is provided", () => {
    firestore.deleteDoc.mockClear();
    expect(() => deleteReport({}, "")).toThrow(TypeError);
    expect(firestore.deleteDoc).not.toHaveBeenCalled();
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

describe("saveReportDocuments", () => {
  it("writes each exported document under its slug, preserving export order", async () => {
    const dummyDb = {};
    firestore.setDoc.mockResolvedValue(undefined);

    await saveReportDocuments(dummyDb, "report-1", [
      { slug: "X-1", title: "Test Report X-1", assetPath: "./a.pdf" },
      { slug: "X-1-DS1", title: "DS1 Datasheet", subtitle: "DS1 (2)", data: "[]" },
    ]);

    expect(firestore.setDoc).toHaveBeenCalledTimes(2);
    const [firstRef, firstPayload] = firestore.setDoc.mock.calls[0];
    expect(firstRef).toEqual({
      db: dummyDb,
      name: `${SAVED_REPORTS_COLLECTION}/report-1/${REPORT_DOCUMENTS_COLLECTION}`,
      id: "X-1",
    });
    expect(firstPayload).toEqual({
      slug: "X-1",
      title: "Test Report X-1",
      subtitle: "",
      assetPath: "./a.pdf",
      data: null,
      order: 0,
    });

    const [, secondPayload] = firestore.setDoc.mock.calls[1];
    expect(secondPayload).toMatchObject({ slug: "X-1-DS1", data: "[]", assetPath: null, order: 1 });
  });

  it("requires a report id", async () => {
    firestore.setDoc.mockClear();
    await expect(saveReportDocuments({}, "", [])).rejects.toThrow(TypeError);
    expect(firestore.setDoc).not.toHaveBeenCalled();
  });
});

describe("fetchReportDocuments", () => {
  it("loads a report's documents in export order", async () => {
    firestore.getDocs.mockResolvedValueOnce({
      docs: [
        { id: "X-1", data: () => ({ slug: "X-1", title: "Test Report", order: 0 }) },
        { id: "Summary", data: () => ({ slug: "Summary", title: "Summary", order: 1 }) },
      ],
    });

    const documents = await fetchReportDocuments({}, "report-1");
    expect(firestore.orderBy).toHaveBeenCalledWith("order", "asc");
    expect(documents.map((entry) => entry.slug)).toEqual(["X-1", "Summary"]);
  });

  it("requires a report id", async () => {
    await expect(fetchReportDocuments({}, "")).rejects.toThrow(TypeError);
  });
});
