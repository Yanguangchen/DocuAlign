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

const mockDeleteReport = vi.fn();

vi.mock("./lib/reports.js", () => ({
  fetchReports: (...args) => mockFetchReports(...args),
  filterReportsByDate: (...args) => mockFilterReportsByDate(...args),
  deleteReport: (...args) => mockDeleteReport(...args),
}));

const SHARE_TOKEN = "aB3dEfGh1JkLmNoPqRsTuVwXyZ012345";
const SHARE_URL = `https://example.com/view.html?share=${SHARE_TOKEN}`;
const BUNDLE_TOKEN = "Bb3dEfGh1JkLmNoPqRsTuVwXyZ012345";
const BUNDLE_URL = `https://example.com/view.html?bundle=${BUNDLE_TOKEN}`;
const mockPublishReport = vi.fn();
const mockBuildPublicUrl = vi.fn(() => SHARE_URL);
const mockPublishBundle = vi.fn();
const mockBuildBundleUrl = vi.fn(() => BUNDLE_URL);

vi.mock("./lib/share.js", () => ({
  publishReport: (...args) => mockPublishReport(...args),
  buildPublicUrl: (...args) => mockBuildPublicUrl(...args),
  publishBundle: (...args) => mockPublishBundle(...args),
  buildBundleUrl: (...args) => mockBuildBundleUrl(...args),
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
      <section id="bundle-bar" hidden>
        <span id="bundle-count"></span>
        <button id="bundle-create" type="button">Create group link</button>
        <p id="bundle-link" hidden></p>
      </section>
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
      "[DocuAlign] Load saved reports failed",
      expect.any(Error),
      expect.objectContaining({ feature: "Dashboard", function: "loadReports" })
    );
    consoleSpy.mockRestore();
  });

  it("logs an anonymous safe identifier when a fetch fails without a uid", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockFetchReports.mockRejectedValueOnce(new Error("API failure"));
    const { loadReports } = await import("./dashboard.js");
    await loadReports({});

    expect(consoleSpy).toHaveBeenCalledWith(
      "[DocuAlign] Load saved reports failed",
      expect.any(Error),
      expect.objectContaining({ safeIdentifier: "anonymous" })
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

  describe("public share links", () => {
    async function renderOneReport() {
      mockFetchReports.mockResolvedValueOnce([
        { id: "doc-1", reportName: "Report 1", matchFilter: true },
      ]);
      const dashboard = await import("./dashboard.js");
      if (authStateCallback) authStateCallback({ uid: "user-share" });
      await new Promise((r) => setTimeout(r, 15));
      return dashboard;
    }

    it("renders a share button on cards for saved reports", async () => {
      const { reportCard } = await import("./dashboard.js");
      const html = reportCard({ id: "doc-1", reportName: "Report 1" });
      expect(html).toContain("share-button");
      expect(html).toContain('data-report-id="doc-1"');
    });

    it("omits the share button when a report has no document id", async () => {
      const { reportCard } = await import("./dashboard.js");
      expect(reportCard({ reportName: "Unsaved" })).not.toContain("share-button");
    });

    it("publishes the report and shows the public URL on click", async () => {
      mockPublishReport.mockResolvedValueOnce(SHARE_TOKEN);
      await renderOneReport();

      const button = document.querySelector(".share-button");
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 15));

      expect(mockPublishReport).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ id: "doc-1" }),
      );
      expect(mockBuildPublicUrl).toHaveBeenCalledWith(SHARE_TOKEN);

      const link = document.querySelector(".share-link a");
      expect(link.getAttribute("href")).toBe(SHARE_URL);
      expect(link.textContent).toBe(SHARE_URL);
      expect(button.disabled).toBe(true);
      expect(button.textContent).toContain("created");
    });

    it("copies the public URL to the clipboard when available", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });
      mockPublishReport.mockResolvedValueOnce(SHARE_TOKEN);
      await renderOneReport();

      document
        .querySelector(".share-button")
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 15));

      expect(writeText).toHaveBeenCalledWith(SHARE_URL);
      delete navigator.clipboard;
    });

    it("re-enables the button and reports failures on publish error", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockPublishReport.mockRejectedValueOnce(new Error("denied"));
      await renderOneReport();

      const button = document.querySelector(".share-button");
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 15));

      expect(button.disabled).toBe(false);
      expect(document.querySelector(".share-link").textContent).toBe(
        "Could not create the public link. Try again.",
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        "[DocuAlign] Publish public share link failed",
        expect.any(Error),
        expect.objectContaining({ feature: "PublicShare", function: "handleShareClick" }),
      );
      consoleSpy.mockRestore();
    });

    it("still succeeds when the clipboard copy is rejected", async () => {
      const writeText = vi.fn().mockRejectedValue(new Error("denied"));
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });
      mockPublishReport.mockResolvedValueOnce(SHARE_TOKEN);
      await renderOneReport();

      const button = document.querySelector(".share-button");
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 15));

      expect(button.textContent).toContain("created");
      expect(document.querySelector(".share-link a").getAttribute("href")).toBe(SHARE_URL);
      delete navigator.clipboard;
    });

    it("still shows the link when no clipboard API is available", async () => {
      Object.defineProperty(navigator, "clipboard", {
        value: undefined,
        configurable: true,
      });
      mockPublishReport.mockResolvedValueOnce(SHARE_TOKEN);
      await renderOneReport();

      const button = document.querySelector(".share-button");
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 15));

      expect(document.querySelector(".share-link a").getAttribute("href")).toBe(SHARE_URL);
      delete navigator.clipboard;
    });

    it("tolerates cards without a share output element", async () => {
      mockPublishReport.mockResolvedValueOnce(SHARE_TOKEN);
      const { handleShareClick } = await renderOneReport();

      const detached = document.createElement("button");
      detached.dataset.reportId = "doc-1";
      await handleShareClick(detached);
      expect(detached.disabled).toBe(true);

      mockPublishReport.mockRejectedValueOnce(new Error("denied"));
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const failing = document.createElement("button");
      failing.dataset.reportId = "doc-1";
      await handleShareClick(failing);
      expect(failing.disabled).toBe(false);
      consoleSpy.mockRestore();
    });

    it("ignores clicks that are not on a share button", async () => {
      await renderOneReport();
      document
        .querySelector(".report-card")
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(mockPublishReport).not.toHaveBeenCalled();
    });

    it("ignores share clicks for reports that are no longer loaded", async () => {
      await renderOneReport();
      const button = document.querySelector(".share-button");
      button.dataset.reportId = "gone";
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 15));
      expect(mockPublishReport).not.toHaveBeenCalled();
    });
  });

  describe("group links (bundles)", () => {
    async function renderReports(reports) {
      mockFetchReports.mockResolvedValueOnce(reports);
      const dashboard = await import("./dashboard.js");
      if (authStateCallback) authStateCallback({ uid: "user-bundle" });
      await new Promise((r) => setTimeout(r, 15));
      return dashboard;
    }

    function toggle(reportId, checked = true) {
      const box = document.querySelector(`.bundle-checkbox[data-report-id="${reportId}"]`);
      box.checked = checked;
      box.dispatchEvent(new Event("change", { bubbles: true }));
      return box;
    }

    const twoReports = [
      { id: "doc-1", reportName: "Report 1", matchFilter: true },
      { id: "doc-2", reportName: "Report 2", matchFilter: true },
    ];

    it("renders a group checkbox only on saved report cards", async () => {
      const { reportCard } = await import("./dashboard.js");
      expect(reportCard({ id: "doc-1" })).toContain("bundle-checkbox");
      expect(reportCard({ reportName: "unsaved" })).not.toContain("bundle-checkbox");
    });

    it("shows the bundle bar with a count while reports are selected", async () => {
      await renderReports(twoReports);
      const bar = document.querySelector("#bundle-bar");
      expect(bar.hidden).toBe(true);

      toggle("doc-1");
      expect(bar.hidden).toBe(false);
      expect(document.querySelector("#bundle-count").textContent).toBe("1 report selected");

      toggle("doc-2");
      expect(document.querySelector("#bundle-count").textContent).toBe("2 reports selected");

      toggle("doc-1", false);
      toggle("doc-2", false);
      expect(bar.hidden).toBe(true);
    });

    it("publishes the selected reports as one group link on click", async () => {
      mockPublishBundle.mockResolvedValueOnce(BUNDLE_TOKEN);
      await renderReports(twoReports);
      toggle("doc-1");
      toggle("doc-2");

      const button = document.querySelector("#bundle-create");
      button.click();
      await new Promise((r) => setTimeout(r, 15));

      expect(mockPublishBundle).toHaveBeenCalledWith(expect.anything(), [
        expect.objectContaining({ id: "doc-1" }),
        expect.objectContaining({ id: "doc-2" }),
      ]);
      expect(mockBuildBundleUrl).toHaveBeenCalledWith(BUNDLE_TOKEN);

      const link = document.querySelector("#bundle-link a");
      expect(link.getAttribute("href")).toBe(BUNDLE_URL);
      expect(link.textContent).toBe(BUNDLE_URL);
      expect(button.disabled).toBe(true);
      expect(button.textContent).toContain("created");
    });

    it("copies the group URL to the clipboard when available", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });
      mockPublishBundle.mockResolvedValueOnce(BUNDLE_TOKEN);
      await renderReports(twoReports);
      toggle("doc-1");

      document.querySelector("#bundle-create").click();
      await new Promise((r) => setTimeout(r, 15));

      expect(writeText).toHaveBeenCalledWith(BUNDLE_URL);
      delete navigator.clipboard;
    });

    it("still shows the group link without a clipboard or when the copy fails", async () => {
      Object.defineProperty(navigator, "clipboard", {
        value: undefined,
        configurable: true,
      });
      mockPublishBundle.mockResolvedValueOnce(BUNDLE_TOKEN);
      await renderReports(twoReports);
      toggle("doc-1");
      document.querySelector("#bundle-create").click();
      await new Promise((r) => setTimeout(r, 15));
      expect(document.querySelector("#bundle-link a").getAttribute("href")).toBe(BUNDLE_URL);

      const writeText = vi.fn().mockRejectedValue(new Error("denied"));
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });
      mockPublishBundle.mockResolvedValueOnce(BUNDLE_TOKEN);
      toggle("doc-2");
      document.querySelector("#bundle-create").click();
      await new Promise((r) => setTimeout(r, 15));
      expect(document.querySelector("#bundle-create").textContent).toContain("created");
      delete navigator.clipboard;
    });

    it("ignores change events that are not from a group checkbox", async () => {
      await renderReports(twoReports);
      document
        .querySelector(".share-button")
        .dispatchEvent(new Event("change", { bubbles: true }));
      expect(document.querySelector("#bundle-bar").hidden).toBe(true);
    });

    it("re-enables the group button after a new selection change", async () => {
      mockPublishBundle.mockResolvedValueOnce(BUNDLE_TOKEN);
      await renderReports(twoReports);
      toggle("doc-1");

      const button = document.querySelector("#bundle-create");
      button.click();
      await new Promise((r) => setTimeout(r, 15));
      expect(button.disabled).toBe(true);

      toggle("doc-2");
      expect(button.disabled).toBe(false);
      expect(button.textContent).toBe("Create group link");
      expect(document.querySelector("#bundle-link").hidden).toBe(true);
    });

    it("reports group publish failures and allows retrying", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockPublishBundle.mockRejectedValueOnce(new Error("denied"));
      await renderReports(twoReports);
      toggle("doc-1");

      const button = document.querySelector("#bundle-create");
      button.click();
      await new Promise((r) => setTimeout(r, 15));

      expect(button.disabled).toBe(false);
      expect(document.querySelector("#bundle-link").textContent).toBe(
        "Could not create the group link. Try again.",
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        "[DocuAlign] Publish group link failed",
        expect.any(Error),
        expect.objectContaining({ feature: "PublicShare", function: "handleBundleClick" }),
      );
      consoleSpy.mockRestore();
    });

    it("keeps the selection across re-renders and drops filtered-out reports", async () => {
      const { render } = await renderReports([
        { id: "doc-1", reportName: "Report 1", matchFilter: true },
        { id: "doc-2", reportName: "Report 2", matchFilter: false },
      ]);
      toggle("doc-1");
      toggle("doc-2");
      expect(document.querySelector("#bundle-count").textContent).toBe("2 reports selected");

      document.querySelector("#filter-from").value = "2026-06-01";
      render();

      // doc-2 is filtered out of the grid, so only doc-1 stays selected.
      expect(
        document.querySelector('.bundle-checkbox[data-report-id="doc-1"]').checked,
      ).toBe(true);
      expect(document.querySelector("#bundle-count").textContent).toBe("1 report selected");
    });

    it("ignores group clicks when nothing is selected", async () => {
      await renderReports(twoReports);
      document.querySelector("#bundle-create").click();
      await new Promise((r) => setTimeout(r, 15));
      expect(mockPublishBundle).not.toHaveBeenCalled();
    });
  });

  describe("delete report", () => {
    async function renderReports(reports) {
      mockFetchReports.mockResolvedValueOnce(reports);
      const dashboard = await import("./dashboard.js");
      if (authStateCallback) authStateCallback({ uid: "user-delete" });
      await new Promise((r) => setTimeout(r, 15));
      return dashboard;
    }

    const twoReports = [
      { id: "doc-1", reportName: "Report 1", matchFilter: true },
      { id: "doc-2", reportName: "Report 2", matchFilter: true },
    ];

    it("renders a delete button only on saved report cards", async () => {
      const { reportCard } = await import("./dashboard.js");
      const saved = reportCard({ id: "doc-1", reportName: "Report 1" });
      expect(saved).toContain("delete-button");
      expect(saved).toContain('data-report-id="doc-1"');
      expect(reportCard({ reportName: "unsaved" })).not.toContain("delete-button");
    });

    it("arms the delete button on the first click without deleting", async () => {
      await renderReports(twoReports);
      const button = document.querySelector(".delete-button");

      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 15));

      expect(mockDeleteReport).not.toHaveBeenCalled();
      expect(button.textContent).toContain("Confirm");
      expect(button.dataset.armed).toBe("true");
    });

    it("deletes the report on the second (confirming) click and re-renders", async () => {
      mockDeleteReport.mockResolvedValueOnce(undefined);
      await renderReports(twoReports);
      const button = document.querySelector(".delete-button");

      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 15));

      expect(mockDeleteReport).toHaveBeenCalledWith(expect.anything(), "doc-1");
      // The deleted card is gone; the other report remains.
      const remaining = [...document.querySelectorAll(".delete-button")].map(
        (b) => b.dataset.reportId,
      );
      expect(remaining).toEqual(["doc-2"]);
      expect(document.querySelector("#result-count").textContent).toBe("1 report");
    });

    it("re-enables and reports failures on delete error, keeping the card", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockDeleteReport.mockRejectedValueOnce(new Error("denied"));
      await renderReports(twoReports);
      const button = document.querySelector(".delete-button");

      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 15));

      expect(button.disabled).toBe(false);
      expect(button.dataset.armed).toBe("false");
      expect(document.querySelectorAll(".delete-button")).toHaveLength(2);
      expect(consoleSpy).toHaveBeenCalledWith(
        "[DocuAlign] Delete report failed",
        expect.any(Error),
        expect.objectContaining({ feature: "Dashboard", function: "handleDeleteClick" }),
      );
      consoleSpy.mockRestore();
    });

    it("ignores delete clicks for reports that are no longer loaded", async () => {
      await renderReports(twoReports);
      const button = document.querySelector(".delete-button");
      button.dataset.reportId = "gone";
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 15));
      expect(mockDeleteReport).not.toHaveBeenCalled();
    });

    it("drops a deleted report from the group selection", async () => {
      mockDeleteReport.mockResolvedValueOnce(undefined);
      const { handleDeleteClick } = await renderReports(twoReports);

      const box = document.querySelector('.bundle-checkbox[data-report-id="doc-1"]');
      box.checked = true;
      box.dispatchEvent(new Event("change", { bubbles: true }));
      expect(document.querySelector("#bundle-count").textContent).toBe("1 report selected");

      const button = document.querySelector('.delete-button[data-report-id="doc-1"]');
      await handleDeleteClick(button); // arm
      await handleDeleteClick(button); // confirm

      expect(document.querySelector("#bundle-bar").hidden).toBe(true);
    });
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
