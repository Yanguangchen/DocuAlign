import { describe, it, expect, vi, beforeEach } from "vitest";

let authStateCallback = null;
vi.mock("firebase/auth", () => ({
  onAuthStateChanged: vi.fn((auth, callback) => {
    authStateCallback = callback;
    return vi.fn();
  }),
}));

vi.mock("./lib/firebase.js", () => ({
  auth: {},
  db: {},
}));

const mockFetchReports = vi.fn();
const mockFilterReportsByDate = vi.fn((reports, range) => {
  if (!range.from && !range.to) return reports;
  return reports.filter((r) => r.matchFilter);
});

vi.mock("./lib/reports.js", () => ({
  fetchReports: (...args) => mockFetchReports(...args),
  filterReportsByDate: (...args) => mockFilterReportsByDate(...args),
}));

describe("dashboard module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    document.body.innerHTML = `
      <form id="date-filter">
        <input id="filter-from" value="" />
        <input id="filter-to" value="" />
      </form>
      <div id="dashboard-status"></div>
      <ul id="report-grid"></ul>
      <span id="result-count"></span>
    `;
  });

  it("exports escapeHtml that properly escapes HTML characters", async () => {
    const { escapeHtml } = await import("./dashboard.js");
    expect(escapeHtml('<script>alert("XSS" & \'test\')</script>')).toBe(
      "&lt;script&gt;alert(&quot;XSS&quot; &amp; &#39;test&#39;)&lt;/script&gt;"
    );
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });

  it("exports setStatus toggling status and grid visibility", async () => {
    const { setStatus } = await import("./dashboard.js");
    const status = document.querySelector("#dashboard-status");
    const grid = document.querySelector("#report-grid");

    setStatus("Loading data...");
    expect(status.textContent).toBe("Loading data...");
    expect(status.hidden).toBe(false);
    expect(grid.hidden).toBe(true);

    setStatus("");
    expect(status.hidden).toBe(true);
    expect(grid.hidden).toBe(false);
  });

  it("exports reportCard rendering formatted report item", async () => {
    const { reportCard } = await import("./dashboard.js");
    const html = reportCard({
      reportName: "My Lab Report",
      createdAt: new Date("2026-06-15T10:00:00"),
      status: "complete",
      sourceFileName: "raw.xlsx",
      createdBy: "user@example.com",
    });
    expect(html).toContain("My Lab Report");
    expect(html).toContain("raw.xlsx");
    expect(html).toContain("user@example.com");
    expect(html).toContain("complete");
  });

  it("exports reportCard with fallbacks for missing metadata", async () => {
    const { reportCard } = await import("./dashboard.js");
    const html = reportCard({});
    expect(html).toContain("Untitled report");
    expect(html).toContain("Date unavailable");
    expect(html).toContain("saved");
  });

  it("renders empty state when allReports is empty", async () => {
    const { render } = await import("./dashboard.js");
    render();
    expect(document.querySelector("#dashboard-status").textContent).toBe(
      "No saved reports yet. Saved reports will appear here."
    );
    expect(document.querySelector("#result-count").textContent).toBe("");
  });

  it("loads reports and renders filtered results and pluralization", async () => {
    mockFetchReports.mockResolvedValueOnce([
      { id: "1", reportName: "Report 1", matchFilter: true },
      { id: "2", reportName: "Report 2", matchFilter: true },
    ]);

    await import("./dashboard.js");
    if (authStateCallback) authStateCallback({ uid: "user-123" });

    await new Promise((r) => setTimeout(r, 15));

    expect(mockFetchReports).toHaveBeenCalled();
    expect(document.querySelector("#result-count").textContent).toBe("2 reports");
    expect(document.querySelectorAll(".report-card")).toHaveLength(2);
  });

  it("loads 1 report singular result count", async () => {
    mockFetchReports.mockResolvedValueOnce([
      { id: "1", reportName: "Report 1", matchFilter: true },
    ]);

    await import("./dashboard.js");
    if (authStateCallback) authStateCallback({ uid: "user-single" });

    await new Promise((r) => setTimeout(r, 15));

    expect(document.querySelector("#result-count").textContent).toBe("1 report");
  });

  it("renders filtered out empty state when filter is active", async () => {
    mockFetchReports.mockResolvedValueOnce([
      { id: "1", reportName: "Report 1", matchFilter: false },
    ]);

    const { render } = await import("./dashboard.js");
    if (authStateCallback) authStateCallback({ uid: "user-filter" });
    await new Promise((r) => setTimeout(r, 15));

    document.querySelector("#filter-from").value = "2026-06-01";
    render();

    expect(document.querySelector("#dashboard-status").textContent).toBe(
      "No reports match the selected date range."
    );
  });

  it("handles fetchReports error gracefully", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockFetchReports.mockRejectedValueOnce(new Error("API failure"));
    await import("./dashboard.js");
    if (authStateCallback) authStateCallback({ uid: "user-err" });

    await new Promise((r) => setTimeout(r, 15));

    expect(document.querySelector("#dashboard-status").textContent).toBe(
      "Could not load saved reports. Check your connection and try again."
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      "[DocuAlign] Failed to load saved reports",
      expect.any(Error),
      expect.objectContaining({ feature: "Dashboard", function: "loadReports" })
    );
    consoleSpy.mockRestore();
  });

  it("handles unauthenticated state or sign out", async () => {
    await import("./dashboard.js");
    if (authStateCallback) authStateCallback(null);

    expect(document.querySelector("#dashboard-status").textContent).toBe(
      "Sign in to view your saved reports."
    );
    expect(document.querySelector("#report-grid").innerHTML).toBe("");
  });

  it("triggers form reset and input events", async () => {
    await import("./dashboard.js");
    const form = document.querySelector("#date-filter");
    form.dispatchEvent(new Event("input"));
    form.dispatchEvent(new Event("reset"));
  });

  it("skips loading if reports are already loaded for the same user", async () => {
    mockFetchReports.mockResolvedValue([
      { id: "1", reportName: "Report 1", matchFilter: true }
    ]);
    const { loadReports } = await import("./dashboard.js");
    await loadReports({ uid: "user-repeat" });
    const callsCount = mockFetchReports.mock.calls.length;
    await loadReports({ uid: "user-repeat" });
    expect(mockFetchReports.mock.calls.length).toBe(callsCount);
  });

  it("renders filtered count X of Y reports when active filter matches subset", async () => {
    mockFetchReports.mockResolvedValueOnce([
      { id: "1", reportName: "Report 1", matchFilter: true },
      { id: "2", reportName: "Report 2", matchFilter: false },
    ]);
    const { render } = await import("./dashboard.js");
    if (authStateCallback) authStateCallback({ uid: "user-subset" });
    await new Promise((r) => setTimeout(r, 15));

    document.querySelector("#filter-from").value = "2026-06-01";
    render();

    expect(document.querySelector("#result-count").textContent).toBe("1 of 2 reports");
  });

  it("renders fallback empty message when filtered is empty without active filter", async () => {
    mockFetchReports.mockResolvedValueOnce([
      { id: "1", reportName: "Report 1" },
    ]);
    mockFilterReportsByDate.mockReturnValueOnce([]);
    const { loadReports } = await import("./dashboard.js");
    await loadReports({ uid: "user-empty-unfiltered" });
    expect(document.querySelector("#dashboard-status").textContent).toBe("No saved reports yet.");
  });
});
