import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./lib/firebase.js", () => ({
  db: {},
}));

const mockFetchSharedReport = vi.fn();
const mockFetchSharedBundle = vi.fn();
vi.mock("./lib/share.js", async () => {
  const actual = await vi.importActual("./lib/share.js");
  return {
    ...actual,
    fetchSharedReport: (...args) => mockFetchSharedReport(...args),
    fetchSharedBundle: (...args) => mockFetchSharedBundle(...args),
  };
});

const VALID_TOKEN = "aB3dEfGh1JkLmNoPqRsTuVwXyZ012345";

function share(overrides = {}) {
  return {
    token: VALID_TOKEN,
    reportId: "doc-1",
    reportName: "rak-report",
    sourceFileName: "rak-report.xlsx",
    status: "complete",
    pdfUrl: "SampleDocuments/SampleOutput.pdf",
    publishedAt: new Date("2026-06-15T10:00:00"),
    ...overrides,
  };
}

describe("view-report module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    document.body.innerHTML = `
      <p id="share-status"></p>
      <article id="share-report" hidden>
        <h1 id="share-report-name"></h1>
        <span id="share-report-status"></span>
        <p id="share-source"></p>
        <span id="share-published"></span>
        <a id="share-pdf-link" href="#"></a>
      </article>
      <article id="share-bundle" hidden>
        <strong id="share-bundle-name"></strong>
        <span id="share-bundle-count"></span>
        <span id="share-bundle-published"></span>
        <ul id="share-bundle-list"></ul>
      </article>
    `;
  });

  function bundle(overrides = {}) {
    return {
      token: VALID_TOKEN,
      bundleName: "Customer pack",
      reports: [
        {
          reportId: "doc-1",
          reportName: "report-a",
          sourceFileName: "a.xlsx",
          status: "complete",
          pdfUrl: "SampleDocuments/SampleOutput.pdf",
        },
        {
          reportId: "doc-2",
          reportName: "report-b",
          sourceFileName: null,
          status: "saved",
          pdfUrl: "javascript:alert(1)",
        },
      ],
      publishedAt: new Date("2026-06-15T10:00:00"),
      ...overrides,
    };
  }

  describe("getShareTokenFromUrl", () => {
    it("extracts the share token from a query string", async () => {
      const { getShareTokenFromUrl } = await import("./view-report.js");
      expect(getShareTokenFromUrl(`?share=${VALID_TOKEN}`)).toBe(VALID_TOKEN);
    });

    it("returns null when the parameter is absent or malformed", async () => {
      const { getShareTokenFromUrl } = await import("./view-report.js");
      expect(getShareTokenFromUrl("")).toBeNull();
      expect(getShareTokenFromUrl("?share=")).toBeNull();
      expect(getShareTokenFromUrl("?share=not-a-token")).toBeNull();
      expect(getShareTokenFromUrl("?other=value")).toBeNull();
    });
  });

  describe("safePdfUrl", () => {
    it("passes through relative paths and https URLs", async () => {
      const { safePdfUrl } = await import("./view-report.js");
      expect(safePdfUrl("SampleDocuments/SampleOutput.pdf")).toBe(
        "SampleDocuments/SampleOutput.pdf",
      );
      expect(safePdfUrl("https://example.com/report.pdf")).toBe(
        "https://example.com/report.pdf",
      );
    });

    it("falls back to the bundled PDF for unsafe or missing URLs", async () => {
      const { safePdfUrl } = await import("./view-report.js");
      const fallback = "SampleDocuments/SampleOutput.pdf";
      expect(safePdfUrl("javascript:alert(1)")).toBe(fallback);
      expect(safePdfUrl("//evil.example.com/x.pdf")).toBe(fallback);
      expect(safePdfUrl("data:text/html,<script>1</script>")).toBe(fallback);
      expect(safePdfUrl("http://insecure.example.com/x.pdf")).toBe(fallback);
      expect(safePdfUrl("")).toBe(fallback);
      expect(safePdfUrl(null)).toBe(fallback);
    });
  });

  describe("initViewer", () => {
    it("renders the shared report and links its PDF output", async () => {
      mockFetchSharedReport.mockResolvedValueOnce(share());
      const { initViewer } = await import("./view-report.js");

      await initViewer(`?share=${VALID_TOKEN}`);

      expect(mockFetchSharedReport).toHaveBeenCalledWith({}, VALID_TOKEN);
      expect(document.querySelector("#share-report").hidden).toBe(false);
      expect(document.querySelector("#share-status").hidden).toBe(true);
      expect(document.querySelector("#share-report-name").textContent).toBe("rak-report");
      expect(document.querySelector("#share-report-status").textContent).toBe("complete");
      expect(document.querySelector("#share-source").textContent).toContain("rak-report.xlsx");
      expect(document.querySelector("#share-published").textContent).not.toBe("");
      expect(document.querySelector("#share-pdf-link").getAttribute("href")).toBe(
        "SampleDocuments/SampleOutput.pdf",
      );
    });

    it("renders fallbacks when optional share fields are missing", async () => {
      mockFetchSharedReport.mockResolvedValueOnce(
        share({ reportName: null, sourceFileName: null, status: null, publishedAt: null }),
      );
      const { initViewer } = await import("./view-report.js");

      await initViewer(`?share=${VALID_TOKEN}`);

      expect(document.querySelector("#share-report-name").textContent).toBe("Untitled report");
      expect(document.querySelector("#share-report-status").textContent).toBe("saved");
      expect(document.querySelector("#share-source").textContent).toBe("");
      expect(document.querySelector("#share-published").textContent).toBe("Date unavailable");
    });

    it("shows an invalid-link message without querying Firestore", async () => {
      const { initViewer } = await import("./view-report.js");

      await initViewer("?share=broken");

      expect(mockFetchSharedReport).not.toHaveBeenCalled();
      expect(document.querySelector("#share-report").hidden).toBe(true);
      expect(document.querySelector("#share-status").textContent).toBe(
        "This share link is not valid. Check the URL and try again.",
      );
    });

    it("shows a revoked message when the share no longer exists", async () => {
      mockFetchSharedReport.mockResolvedValueOnce(null);
      const { initViewer } = await import("./view-report.js");

      await initViewer(`?share=${VALID_TOKEN}`);

      expect(document.querySelector("#share-report").hidden).toBe(true);
      expect(document.querySelector("#share-status").textContent).toBe(
        "This share link is no longer available. Ask the report owner for a new link.",
      );
    });

    it("renders every grouped report in a bundle link with safe PDF links", async () => {
      mockFetchSharedBundle.mockResolvedValueOnce(bundle());
      const { initViewer } = await import("./view-report.js");

      await initViewer(`?bundle=${VALID_TOKEN}`);

      expect(mockFetchSharedBundle).toHaveBeenCalledWith({}, VALID_TOKEN);
      expect(mockFetchSharedReport).not.toHaveBeenCalled();
      expect(document.querySelector("#share-bundle").hidden).toBe(false);
      expect(document.querySelector("#share-report").hidden).toBe(true);
      expect(document.querySelector("#share-status").hidden).toBe(true);
      expect(document.querySelector("#share-bundle-name").textContent).toBe("Customer pack");
      expect(document.querySelector("#share-bundle-count").textContent).toBe("2 reports");

      const items = document.querySelectorAll("#share-bundle-list li");
      expect(items).toHaveLength(2);
      expect(items[0].textContent).toContain("report-a");
      expect(items[0].textContent).toContain("a.xlsx");
      const links = document.querySelectorAll("#share-bundle-list a");
      expect(links[0].getAttribute("href")).toBe("SampleDocuments/SampleOutput.pdf");
      // The unsafe javascript: URL must fall back to the bundled PDF.
      expect(links[1].getAttribute("href")).toBe("SampleDocuments/SampleOutput.pdf");
      expect(links[1].getAttribute("rel")).toBe("noopener");
    });

    it("renders bundle fallbacks for missing name, date, and single report", async () => {
      mockFetchSharedBundle.mockResolvedValueOnce(
        bundle({
          bundleName: null,
          publishedAt: null,
          reports: [{ reportId: "doc-1", reportName: null, status: null, pdfUrl: null }],
        }),
      );
      const { initViewer } = await import("./view-report.js");

      await initViewer(`?bundle=${VALID_TOKEN}`);

      expect(document.querySelector("#share-bundle-name").textContent).toBe("Shared reports");
      expect(document.querySelector("#share-bundle-count").textContent).toBe("1 report");
      expect(document.querySelector("#share-bundle-published").textContent).toBe(
        "Date unavailable",
      );
      const item = document.querySelector("#share-bundle-list li");
      expect(item.textContent).toContain("Untitled report");
      expect(item.textContent).toContain("saved");
    });

    it("shows the revoked message when a bundle no longer exists", async () => {
      mockFetchSharedBundle.mockResolvedValueOnce(null);
      const { initViewer } = await import("./view-report.js");

      await initViewer(`?bundle=${VALID_TOKEN}`);

      expect(document.querySelector("#share-bundle").hidden).toBe(true);
      expect(document.querySelector("#share-status").textContent).toBe(
        "This share link is no longer available. Ask the report owner for a new link.",
      );
    });

    it("treats a malformed bundle token as an invalid link", async () => {
      const { initViewer } = await import("./view-report.js");

      await initViewer("?bundle=guessable");

      expect(mockFetchSharedBundle).not.toHaveBeenCalled();
      expect(document.querySelector("#share-status").textContent).toBe(
        "This share link is not valid. Check the URL and try again.",
      );
    });

    it("reports bundle fetch failures with a structured console error", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockFetchSharedBundle.mockRejectedValueOnce(new Error("network down"));
      const { initViewer } = await import("./view-report.js");

      await initViewer(`?bundle=${VALID_TOKEN}`);

      expect(document.querySelector("#share-status").textContent).toBe(
        "Could not load this shared report. Check your connection and try again.",
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        "[DocuAlign] Load shared bundle failed",
        expect.any(Error),
        expect.objectContaining({ feature: "PublicShare", function: "initViewer" }),
      );
      consoleSpy.mockRestore();
    });

    it("defaults to the page URL search and survives a missing location", async () => {
      const { initViewer } = await import("./view-report.js");

      await initViewer();
      expect(document.querySelector("#share-status").textContent).toBe(
        "This share link is not valid. Check the URL and try again.",
      );

      vi.stubGlobal("location", undefined);
      await initViewer();
      expect(document.querySelector("#share-status").textContent).toBe(
        "This share link is not valid. Check the URL and try again.",
      );
      vi.unstubAllGlobals();
      expect(mockFetchSharedReport).not.toHaveBeenCalled();
    });

    it("reports fetch failures with a structured console error", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockFetchSharedReport.mockRejectedValueOnce(new Error("network down"));
      const { initViewer } = await import("./view-report.js");

      await initViewer(`?share=${VALID_TOKEN}`);

      expect(document.querySelector("#share-status").textContent).toBe(
        "Could not load this shared report. Check your connection and try again.",
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        "[DocuAlign] Load shared report failed",
        expect.any(Error),
        expect.objectContaining({ feature: "PublicShare", function: "initViewer" }),
      );
      consoleSpy.mockRestore();
    });
  });
});
