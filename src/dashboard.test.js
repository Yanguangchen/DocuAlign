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
const mockFetchReportDocuments = vi.fn(() => Promise.resolve([]));
const mockFilterReportsByDate = vi.fn((reports, range) => {
  if (!range.from && !range.to) return reports;
  return reports.filter((r) => r.matchFilter);
});

const mockDeleteReport = vi.fn();

vi.mock("./lib/reports.js", () => ({
  fetchReports: (...args) => mockFetchReports(...args),
  fetchReportDocuments: (...args) => mockFetchReportDocuments(...args),
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
      <div id="share-modal-backdrop" hidden>
        <div id="share-modal">
          <button id="share-modal-close" type="button">Close</button>
          <strong id="share-modal-title"></strong>
          <p id="share-modal-link"></p>
          <button id="share-modal-copy" type="button">Copy link</button>
          <p id="share-modal-note"></p>
        </div>
      </div>
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

  it("retains failure details when one report's documents cannot be loaded", async () => {
    const failure = Object.assign(new Error("documents unavailable"), {
      code: "unavailable",
    });
    const warningSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockFetchReports.mockResolvedValueOnce([
      { id: "report-with-failure", reportName: "Report", matchFilter: true },
    ]);
    mockFetchReportDocuments.mockRejectedValueOnce(failure);

    const { loadReports } = await import("./dashboard.js");
    await loadReports({ uid: "user-document-failure" });

    expect(warningSpy).toHaveBeenCalledWith(
      "[DocuAlign] Could not load report documents",
      failure,
      expect.objectContaining({
        feature: "Dashboard",
        function: "loadReports",
        operation: "firestore.getDocs",
        category: "ReportDocumentLoadFailure",
        safeIdentifier: "report:report-with-failure",
        errorCode: "unavailable",
        errorMessage: "documents unavailable",
      }),
    );
    warningSpy.mockRestore();
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

    it("publishes every stored document behind one link on click", async () => {
      // The whole point: no ticking documents into a package first.
      const documents = [
        { slug: "X-1", title: "Test Report X-1" },
        { slug: "X-1-DS1", title: "DS1 Datasheet X-1" },
        { slug: "Summary", title: "Summary" },
      ];
      mockFetchReportDocuments.mockImplementation(() => Promise.resolve(documents));
      mockPublishBundle.mockResolvedValueOnce(BUNDLE_TOKEN);
      await renderOneReport();

      // The card says how many documents the link will carry.
      const button = document.querySelector(".share-button");
      expect(button.textContent).toContain("3 documents");

      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 15));

      expect(mockPublishBundle).toHaveBeenCalledWith(
        expect.anything(),
        documents.map((document) => ({
          report: expect.objectContaining({ id: "doc-1" }),
          document,
        })),
        { name: "Report 1" },
      );
      expect(mockPublishReport).not.toHaveBeenCalled();
      expect(document.querySelector(".share-link a").getAttribute("href")).toBe(BUNDLE_URL);
      mockFetchReportDocuments.mockImplementation(() => Promise.resolve([]));
    });

    it("names the package after the workbook when the report is untitled", async () => {
      mockFetchReportDocuments.mockImplementation(() =>
        Promise.resolve([{ slug: "X-1", title: "Test Report X-1" }]));
      mockPublishBundle.mockResolvedValueOnce(BUNDLE_TOKEN);
      mockFetchReports.mockResolvedValueOnce([
        { id: "doc-1", sourceFileName: "lab-data.xlsx", matchFilter: true },
      ]);
      const dashboard = await import("./dashboard.js");
      if (authStateCallback) authStateCallback({ uid: "user-share" });
      await new Promise((r) => setTimeout(r, 15));

      document.querySelector(".share-button")
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 15));

      expect(mockPublishBundle).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { name: "lab-data.xlsx" },
      );
      expect(dashboard).toBeTruthy();
      mockFetchReportDocuments.mockImplementation(() => Promise.resolve([]));
    });

    it("falls back to an unnamed package when the report has no name at all", async () => {
      mockFetchReportDocuments.mockImplementation(() =>
        Promise.resolve([{ slug: "X-1", title: "Test Report X-1" }]));
      mockPublishBundle.mockResolvedValueOnce(BUNDLE_TOKEN);
      mockFetchReports.mockResolvedValueOnce([{ id: "doc-1", matchFilter: true }]);
      await import("./dashboard.js");
      if (authStateCallback) authStateCallback({ uid: "user-share" });
      await new Promise((r) => setTimeout(r, 15));

      document.querySelector(".share-button")
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 15));

      expect(mockPublishBundle).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { name: null },
      );
      mockFetchReportDocuments.mockImplementation(() => Promise.resolve([]));
    });

    it("explains a package that exceeds the size limit instead of inviting a retry", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockFetchReportDocuments.mockImplementation(() =>
        Promise.resolve([{ slug: "X-1", title: "Test Report X-1" }]));
      mockPublishBundle.mockRejectedValueOnce(
        new TypeError("A package can hold at most 25 documents."),
      );
      await renderOneReport();

      document.querySelector(".share-button")
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 15));

      expect(document.querySelector(".share-link").textContent).toBe(
        "A package can hold at most 25 documents.",
      );
      consoleSpy.mockRestore();
      mockFetchReportDocuments.mockImplementation(() => Promise.resolve([]));
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

    it("renders a copy button that re-copies the link on demand", async () => {
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

      // The creation-time copy already happened; clicking the button must
      // copy again rather than relying on that first, easy-to-miss copy.
      writeText.mockClear();
      const copyButton = document.querySelector(".share-link .copy-link-button");
      expect(copyButton.getAttribute("aria-label")).toBe("Copy link");

      vi.useFakeTimers();
      try {
        copyButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await vi.advanceTimersByTimeAsync(0);

        expect(writeText).toHaveBeenCalledWith(SHARE_URL);
        expect(copyButton.classList.contains("is-copied")).toBe(true);
        expect(document.querySelector(".share-link .copy-feedback").textContent)
          .toBe("Copied!");

        // The feedback is transient, so a later click still shows fresh text.
        await vi.advanceTimersByTimeAsync(2000);
        expect(copyButton.classList.contains("is-copied")).toBe(false);
        expect(document.querySelector(".share-link .copy-feedback").textContent).toBe("");
      } finally {
        vi.useRealTimers();
      }
      delete navigator.clipboard;
    });

    it("tells the user to copy manually when the copy button's copy fails", async () => {
      const writeText = vi.fn().mockRejectedValue(new Error("denied"));
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });
      vi.spyOn(console, "warn").mockImplementation(() => {});
      mockPublishReport.mockResolvedValueOnce(SHARE_TOKEN);
      await renderOneReport();

      document
        .querySelector(".share-button")
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 15));

      document
        .querySelector(".share-link .copy-link-button")
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 15));

      expect(document.querySelector(".share-link .copy-feedback").textContent).toBe(
        "Could not copy — select the link instead.",
      );
      expect(document.querySelector(".share-link .copy-link-button").classList.contains(
        "is-copied",
      )).toBe(false);
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
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
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
      expect(warnSpy).toHaveBeenCalledWith(
        "[DocuAlign] Clipboard copy failed",
        expect.objectContaining({
          function: "handleShareClick",
          operation: "clipboard.writeText",
          category: "ClipboardFailure",
          errorMessage: "Error: denied",
        }),
      );
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

    function toggle(reportId, checked = true, slug) {
      const selector = slug
        ? `.bundle-checkbox[data-report-id="${reportId}"][data-document-slug="${slug}"]`
        : `.bundle-checkbox[data-report-id="${reportId}"]:not([data-document-slug])`;
      const box = document.querySelector(selector);
      box.checked = checked;
      box.dispatchEvent(new Event("change", { bubbles: true }));
      return box;
    }

    const twoReports = [
      { id: "doc-1", reportName: "Report 1", matchFilter: true },
      { id: "doc-2", reportName: "Report 2", matchFilter: true },
    ];

    it("packages individually selected documents alongside whole reports", async () => {
      mockFetchReportDocuments.mockImplementation((db, reportId) =>
        Promise.resolve(
          reportId === "doc-1"
            ? [
                { slug: "X-1", title: "Test Report X-1", assetPath: "./a.pdf", data: null },
                { slug: "X-1-DS1", title: "DS1 Datasheet X-1", data: "[]" },
                { slug: "Summary", title: "Summary", data: "[]" },
              ]
            : [],
        ),
      );
      mockPublishBundle.mockResolvedValueOnce(BUNDLE_TOKEN);
      await renderReports(twoReports);

      // Every stored document is separately selectable.
      expect(document.querySelectorAll('[data-document-slug]')).toHaveLength(3);

      toggle("doc-1", true, "X-1-DS1");
      toggle("doc-1", true, "Summary");
      toggle("doc-2");
      expect(document.querySelector("#bundle-count").textContent).toBe("3 documents selected");

      document.querySelector("#bundle-create").click();
      await new Promise((r) => setTimeout(r, 15));

      // Documents come first for their report, then the whole-report entry.
      expect(mockPublishBundle).toHaveBeenCalledWith(expect.anything(), [
        {
          report: expect.objectContaining({ id: "doc-1" }),
          document: expect.objectContaining({ slug: "X-1-DS1" }),
        },
        {
          report: expect.objectContaining({ id: "doc-1" }),
          document: expect.objectContaining({ slug: "Summary" }),
        },
        { report: expect.objectContaining({ id: "doc-2" }), document: null },
      ]);
      mockFetchReportDocuments.mockImplementation(() => Promise.resolve([]));
    });

    it("expands two report-level package choices into both complete document sets", async () => {
      const storedDocuments = new Map([
        ["doc-1", [
          { slug: "X-1", title: "Test Report X-1", data: "report-1" },
          { slug: "Summary", title: "Summary X-1", data: "summary-1" },
        ]],
        ["doc-2", [
          { slug: "X-2", title: "Test Report X-2", data: "report-2" },
          { slug: "Summary", title: "Summary X-2", data: "summary-2" },
        ]],
      ]);
      mockFetchReportDocuments.mockImplementation((db, reportId) =>
        Promise.resolve(storedDocuments.get(reportId)),
      );
      mockPublishBundle.mockResolvedValueOnce(BUNDLE_TOKEN);
      await renderReports(twoReports);

      // The card-level checkbox represents the complete stored package, while
      // the nested checkboxes remain available for selecting individual PDFs.
      toggle("doc-1");
      toggle("doc-2");
      expect(document.querySelector("#bundle-count").textContent).toBe(
        "4 documents selected",
      );

      document.querySelector("#bundle-create").click();
      await new Promise((r) => setTimeout(r, 15));

      expect(mockPublishBundle).toHaveBeenCalledWith(expect.anything(), [
        { report: expect.objectContaining({ id: "doc-1" }), document: storedDocuments.get("doc-1")[0] },
        { report: expect.objectContaining({ id: "doc-1" }), document: storedDocuments.get("doc-1")[1] },
        { report: expect.objectContaining({ id: "doc-2" }), document: storedDocuments.get("doc-2")[0] },
        { report: expect.objectContaining({ id: "doc-2" }), document: storedDocuments.get("doc-2")[1] },
      ]);
      mockFetchReportDocuments.mockImplementation(() => Promise.resolve([]));
    });

    it("keeps working for reports saved before documents were persisted", async () => {
      mockFetchReportDocuments.mockRejectedValueOnce(new Error("no subcollection"));
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      await renderReports([twoReports[0]]);

      // The report still renders and remains shareable as a whole, and says
      // why no individual documents are offered.
      expect(document.querySelectorAll(".report-card")).toHaveLength(1);
      expect(document.querySelector(".report-documents")).toBeNull();
      expect(document.querySelector(".report-documents-empty").textContent).toContain(
        "Re-upload this workbook",
      );
      toggle("doc-1");
      expect(document.querySelector("#bundle-count").textContent).toBe("1 document selected");
      consoleSpy.mockRestore();
    });

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
      expect(document.querySelector("#bundle-count").textContent).toBe("1 document selected");

      toggle("doc-2");
      expect(document.querySelector("#bundle-count").textContent).toBe("2 documents selected");

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

      // A package entry pairs the saved report with the specific document to
      // publish; a null document means the report itself.
      expect(mockPublishBundle).toHaveBeenCalledWith(expect.anything(), [
        { report: expect.objectContaining({ id: "doc-1" }), document: null },
        { report: expect.objectContaining({ id: "doc-2" }), document: null },
      ]);
      expect(mockBuildBundleUrl).toHaveBeenCalledWith(BUNDLE_TOKEN);

      const link = document.querySelector("#bundle-link a");
      expect(link.getAttribute("href")).toBe(BUNDLE_URL);
      expect(link.textContent).toBe(BUNDLE_URL);
      expect(button.disabled).toBe(true);
      expect(button.textContent).toContain("created");
    });

    it("also gives the group link its own re-copy button", async () => {
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

      writeText.mockClear();
      document
        .querySelector("#bundle-link .copy-link-button")
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 15));

      expect(writeText).toHaveBeenCalledWith(BUNDLE_URL);
      delete navigator.clipboard;
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
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
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
      expect(warnSpy).toHaveBeenCalledWith(
        "[DocuAlign] Clipboard copy failed",
        expect.objectContaining({
          function: "handleBundleClick",
          operation: "clipboard.writeText",
          category: "ClipboardFailure",
          errorMessage: "Error: denied",
        }),
      );
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
      expect(button.textContent).toBe("Create package link");
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
      expect(document.querySelector("#bundle-count").textContent).toBe("2 documents selected");

      document.querySelector("#filter-from").value = "2026-06-01";
      render();

      // doc-2 is filtered out of the grid, so only doc-1 stays selected.
      expect(
        document.querySelector('.bundle-checkbox[data-report-id="doc-1"]').checked,
      ).toBe(true);
      expect(document.querySelector("#bundle-count").textContent).toBe("1 document selected");
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
      expect(document.querySelector("#bundle-count").textContent).toBe("1 document selected");

      const button = document.querySelector('.delete-button[data-report-id="doc-1"]');
      await handleDeleteClick(button); // arm
      await handleDeleteClick(button); // confirm

      expect(document.querySelector("#bundle-bar").hidden).toBe(true);
    });
  });

  describe("share modal", () => {
    async function renderOneReport() {
      mockFetchReports.mockResolvedValueOnce([
        { id: "doc-1", reportName: "Report 1", matchFilter: true },
      ]);
      const dashboard = await import("./dashboard.js");
      if (authStateCallback) authStateCallback({ uid: "user-modal" });
      await new Promise((r) => setTimeout(r, 15));
      return dashboard;
    }

    async function renderReports(reports) {
      mockFetchReports.mockResolvedValueOnce(reports);
      const dashboard = await import("./dashboard.js");
      if (authStateCallback) authStateCallback({ uid: "user-modal-bundle" });
      await new Promise((r) => setTimeout(r, 15));
      return dashboard;
    }

    function toggle(reportId, checked = true) {
      const box = document.querySelector(
        `.bundle-checkbox[data-report-id="${reportId}"]:not([data-document-slug])`,
      );
      box.checked = checked;
      box.dispatchEvent(new Event("change", { bubbles: true }));
      return box;
    }

    const twoReports = [
      { id: "doc-1", reportName: "Report 1", matchFilter: true },
      { id: "doc-2", reportName: "Report 2", matchFilter: true },
    ];

    it("opens with the link ready to copy after a report link is created", async () => {
      mockPublishReport.mockResolvedValueOnce(SHARE_TOKEN);
      await renderOneReport();

      document
        .querySelector(".share-button")
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 15));

      expect(document.querySelector("#share-modal-backdrop").hidden).toBe(false);
      expect(document.querySelector("#share-modal-link").textContent).toBe(SHARE_URL);
      expect(document.querySelector("#share-modal-copy")).not.toBeNull();
    });

    it("opens with the group link after one is created", async () => {
      mockPublishBundle.mockResolvedValueOnce(BUNDLE_TOKEN);
      await renderReports(twoReports);
      toggle("doc-1");
      toggle("doc-2");

      document.querySelector("#bundle-create").click();
      await new Promise((r) => setTimeout(r, 15));

      expect(document.querySelector("#share-modal-backdrop").hidden).toBe(false);
      expect(document.querySelector("#share-modal-link").textContent).toBe(BUNDLE_URL);
    });

    it("closes on the close button, the backdrop, and Escape -- but not a panel click", async () => {
      mockPublishReport.mockResolvedValueOnce(SHARE_TOKEN);
      const { openShareModal } = await renderOneReport();
      const backdrop = document.querySelector("#share-modal-backdrop");

      // The share button that opens it is a one-shot action (it disables
      // itself once the link exists), so each reopen below drives the modal
      // directly -- this is exercising the modal's own dismissal behavior,
      // not the button that happens to trigger it the first time.
      document
        .querySelector(".share-button")
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 15));
      expect(backdrop.hidden).toBe(false);

      document.querySelector("#share-modal").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(backdrop.hidden).toBe(false);

      // Dismissal drops `is-open` at once so the exit animation can run, and
      // only hides the element once that animation has had its time.
      backdrop.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(backdrop.classList.contains("is-open")).toBe(false);
      expect(backdrop.hidden).toBe(false);
      await vi.waitFor(() => expect(backdrop.hidden).toBe(true));

      // Escape only acts while the modal is actually open.
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      expect(backdrop.hidden).toBe(true);

      openShareModal(SHARE_URL);
      expect(backdrop.hidden).toBe(false);
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await vi.waitFor(() => expect(backdrop.hidden).toBe(true));

      openShareModal(SHARE_URL);
      document
        .querySelector("#share-modal-close")
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await vi.waitFor(() => expect(backdrop.hidden).toBe(true));
    });

    it("keeps a reopened modal visible when the previous exit timer fires", async () => {
      const { openShareModal, closeShareModal } = await renderOneReport();
      const backdrop = document.querySelector("#share-modal-backdrop");

      // Reopening inside the exit window must not be swallowed by the timer
      // the dismissal left running -- that would blank the modal a moment
      // after it appeared, which is exactly what the `is-open` guard prevents.
      openShareModal(SHARE_URL);
      closeShareModal();
      openShareModal(SHARE_URL);

      await new Promise((r) => setTimeout(r, 260));
      expect(backdrop.hidden).toBe(false);
    });

    it("re-copies the link from the modal's own copy button", async () => {
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
      writeText.mockClear();

      document
        .querySelector("#share-modal-copy")
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 15));

      expect(writeText).toHaveBeenCalledWith(SHARE_URL);
      expect(document.querySelector("#share-modal-note").textContent).toBe("Copied!");
      delete navigator.clipboard;
    });

    it("tells the user to copy manually when the modal's copy button fails", async () => {
      Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
      mockPublishReport.mockResolvedValueOnce(SHARE_TOKEN);
      await renderOneReport();

      document
        .querySelector(".share-button")
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 15));

      document
        .querySelector("#share-modal-copy")
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 15));

      expect(document.querySelector("#share-modal-note").textContent).toBe(
        "Could not copy — select the link above instead.",
      );
      delete navigator.clipboard;
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
