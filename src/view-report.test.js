import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./lib/firebase.js", () => ({
  db: {},
}));

const mockFetchSharedReport = vi.fn();
vi.mock("./lib/share.js", async () => {
  const actual = await vi.importActual("./lib/share.js");
  return {
    ...actual,
    fetchSharedReport: (...args) => mockFetchSharedReport(...args),
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
    `;
  });

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
        "[DocuAlign] Failed to load shared report",
        expect.any(Error),
        expect.objectContaining({ feature: "PublicShare", function: "initViewer" }),
      );
      consoleSpy.mockRestore();
    });
  });
});
