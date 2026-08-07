import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

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
  storage: {},
}));

const mockSaveReport = vi.fn();
const mockSaveReportDocuments = vi.fn();
vi.mock("./lib/reports.js", () => ({
  saveReport: (...args) => mockSaveReport(...args),
  saveReportDocuments: (...args) => mockSaveReportDocuments(...args),
}));

const mockUploadReportPhotos = vi.fn(async () => new Map());
vi.mock("./lib/report-photos.js", () => ({
  uploadReportPhotos: (...args) => mockUploadReportPhotos(...args),
}));

const SHARE_URL = "https://example.com/view.html?share=token";
const BUNDLE_URL = "https://example.com/view.html?bundle=token";
const mockPublishReport = vi.fn();
const mockPublishBundle = vi.fn();
vi.mock("./lib/share.js", () => ({
  publishReport: (...args) => mockPublishReport(...args),
  publishBundle: (...args) => mockPublishBundle(...args),
  buildPublicUrl: () => SHARE_URL,
  buildBundleUrl: () => BUNDLE_URL,
}));

/** The workspace page's DOM, including the share modal save-report opens. */
const WORKSPACE_DOM = `
  <button id="cloud-save"></button>
  <span id="file-name">lab_report.xlsx</span>
  <div id="feedback"></div>
  <div id="share-modal-backdrop" hidden>
    <button id="share-modal-close" type="button"></button>
    <p id="share-modal-link"></p>
    <a id="share-modal-dashboard" hidden></a>
    <button id="share-modal-copy" type="button"></button>
    <p id="share-modal-note"></p>
  </div>
`;

describe("save-report module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("exports reportNameFromSource that sanitises workbook file names", async () => {
    document.body.innerHTML = `
      <button id="cloud-save"></button>
      <span id="file-name">test_report.xlsx</span>
      <div id="feedback"></div>
    `;
    const { reportNameFromSource } = await import("./save-report.js");
    expect(reportNameFromSource("Lab Data 2026.xlsx")).toBe("Lab-Data-2026");
    expect(reportNameFromSource("report.xls")).toBe("report");
    expect(reportNameFromSource("---.xlsx")).toBe("report");
    expect(reportNameFromSource("valid-name_1.xlsx")).toBe("valid-name_1");
  });

  it("exports setFeedback that sets textContent and visibility class", async () => {
    document.body.innerHTML = `
      <button id="cloud-save"></button>
      <span id="file-name">test.xlsx</span>
      <div id="feedback"></div>
    `;
    const { setFeedback } = await import("./save-report.js");
    setFeedback("Test feedback message");
    const fb = document.querySelector("#feedback");
    expect(fb.textContent).toBe("Test feedback message");
    expect(fb.classList.contains("is-visible")).toBe(true);
  });

  it("handles cloudSave click when no source file is processed", async () => {
    document.body.innerHTML = `
      <button id="cloud-save"></button>
      <span id="file-name">   </span>
      <div id="feedback"></div>
    `;
    await import("./save-report.js");
    const btn = document.querySelector("#cloud-save");
    btn.click();
    expect(document.querySelector("#feedback").textContent).toBe(
      "Process a workbook before saving it to the cloud."
    );
  });

  it("handles cloudSave click when user is not signed in", async () => {
    document.body.innerHTML = `
      <button id="cloud-save"></button>
      <span id="file-name">data.xlsx</span>
      <div id="feedback"></div>
    `;
    await import("./save-report.js");
    if (authStateCallback) authStateCallback(null);
    const btn = document.querySelector("#cloud-save");
    btn.click();
    expect(document.querySelector("#feedback").textContent).toBe(
      "Sign in again before saving to the cloud."
    );
  });

  it("handles cloudSave click successfully when user is signed in", async () => {
    document.body.innerHTML = `
      <button id="cloud-save"></button>
      <span id="file-name">my_lab_report.xlsx</span>
      <div id="feedback"></div>
    `;
    mockSaveReport.mockResolvedValueOnce({ id: "123" });
    await import("./save-report.js");
    if (authStateCallback) authStateCallback({ email: "docu@example.com" });

    const btn = document.querySelector("#cloud-save");
    btn.click();

    await new Promise((r) => setTimeout(r, 10));

    expect(mockSaveReport).toHaveBeenCalled();
    expect(document.querySelector("#feedback").textContent).toBe(
      "Report saved. View it anytime on the dashboard."
    );
    expect(btn.disabled).toBe(true);
  });

  it("handles cloudSave click when user has no email property (falls back to null)", async () => {
    document.body.innerHTML = `
      <button id="cloud-save"></button>
      <span id="file-name">no_email.xlsx</span>
      <div id="feedback"></div>
    `;
    mockSaveReport.mockResolvedValueOnce({ id: "456" });
    await import("./save-report.js");
    if (authStateCallback) authStateCallback({});

    const btn = document.querySelector("#cloud-save");
    btn.click();

    await new Promise((r) => setTimeout(r, 10));

    expect(mockSaveReport).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ createdBy: null })
    );
  });

  it("handles saveReport failure and re-enables button", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    document.body.innerHTML = `
      <button id="cloud-save"></button>
      <span id="file-name">error_report.xlsx</span>
      <div id="feedback"></div>
    `;
    mockSaveReport.mockRejectedValueOnce(new Error("Network error"));
    await import("./save-report.js");
    if (authStateCallback) authStateCallback({ email: "docu@example.com" });

    const btn = document.querySelector("#cloud-save");
    btn.click();

    await new Promise((r) => setTimeout(r, 10));

    expect(document.querySelector("#feedback").textContent).toBe(
      "Could not save the report. Check your connection and try again."
    );
    expect(btn.disabled).toBe(false);
    expect(consoleSpy).toHaveBeenCalledWith(
      "[DocuAlign] Save report to cloud failed",
      expect.any(Error),
      expect.objectContaining({ feature: "CloudPersistence", function: "cloudSave.onClick" })
    );
    consoleSpy.mockRestore();
  });

  it("handles missing feedback or cloudSave elements gracefully", async () => {
    document.body.innerHTML = `<div>No elements</div>`;
    const { setFeedback } = await import("./save-report.js");
    expect(() => setFeedback("test")).not.toThrow();
  });

  it("persists every exported document alongside the saved report", async () => {
    document.body.innerHTML = `
      <button id="cloud-save"></button>
      <span id="file-name">lab_data.xlsx</span>
      <div id="feedback"></div>
    `;
    mockSaveReport.mockResolvedValueOnce({ id: "report-9" });
    mockSaveReportDocuments.mockResolvedValueOnce(undefined);
    const documents = [
      { slug: "X-1", title: "Test Report X-1", assetPath: "./a.pdf", data: null },
      { slug: "X-1-DS1", title: "DS1 Datasheet X-1", assetPath: null, data: "[]" },
    ];
    globalThis.docuAlignWorkspace = { getExportDocuments: () => documents };

    await import("./save-report.js");
    if (authStateCallback) authStateCallback({ email: "docu@example.com" });
    document.querySelector("#cloud-save").click();
    await new Promise((r) => setTimeout(r, 10));

    expect(mockSaveReportDocuments).toHaveBeenCalledWith({}, "report-9", documents);
    expect(document.querySelector("#feedback").textContent).toBe(
      "Report saved with 2 documents. View it anytime on the dashboard."
    );
    delete globalThis.docuAlignWorkspace;
  });

  describe("share link and modal after saving", () => {
    async function save(documents) {
      document.body.innerHTML = WORKSPACE_DOM;
      mockSaveReport.mockResolvedValueOnce({ id: "report-1" });
      mockSaveReportDocuments.mockResolvedValueOnce(undefined);
      globalThis.docuAlignWorkspace = { getExportDocuments: () => documents };
      await import("./save-report.js");
      if (authStateCallback) authStateCallback({ email: "docu@example.com" });
      document.querySelector("#cloud-save").click();
      await new Promise((r) => setTimeout(r, 15));
    }

    afterEach(() => {
      delete globalThis.docuAlignWorkspace;
    });

    it("publishes a package link and opens the modal with it", async () => {
      mockPublishBundle.mockResolvedValueOnce("bundle-token");
      const documents = [
        { slug: "Summary", title: "Summary", data: "[]" },
        { slug: "X-1", title: "Test Report X-1", assetPath: "./a.pdf", data: null },
      ];

      await save(documents);

      // Every saved document goes into one package link for the recipient.
      expect(mockPublishBundle).toHaveBeenCalledWith(
        {},
        documents.map((document) => ({
          report: {
            id: "report-1",
            reportName: "lab_report",
            sourceFileName: "lab_report.xlsx",
            status: "complete",
          },
          document,
        })),
        { name: "lab_report" },
      );
      expect(document.querySelector("#share-modal-backdrop").hidden).toBe(false);
      expect(document.querySelector("#share-modal-link").textContent).toBe(BUNDLE_URL);

      // The workspace modal also offers a way straight to the saved documents.
      const dashboard = document.querySelector("#share-modal-dashboard");
      expect(dashboard.hidden).toBe(false);
      expect(dashboard.getAttribute("href")).toBe("./dashboard.html");
    });

    it("uploads the workbook's pictures and publishes their URLs", async () => {
      mockPublishBundle.mockResolvedValueOnce("bundle-token");
      const pictures = [
        { key: "1:photo:0", mimeType: "image/jpeg", bytes: new Uint8Array([1, 2]) },
      ];
      const urls = new Map([["1:photo:0", "https://cdn/1_photo_0?token=t"]]);
      mockUploadReportPhotos.mockResolvedValueOnce(urls);

      document.body.innerHTML = WORKSPACE_DOM;
      mockSaveReport.mockResolvedValueOnce({ id: "report-1" });
      mockSaveReportDocuments.mockResolvedValueOnce(undefined);
      const getExportDocuments = vi.fn(() => [{ slug: "X-1", title: "Test Report X-1", data: "{}" }]);
      globalThis.docuAlignWorkspace = {
        getPublishableAssets: () => pictures,
        getExportDocuments,
      };
      await import("./save-report.js");
      if (authStateCallback) authStateCallback({ email: "docu@example.com" });
      document.querySelector("#cloud-save").click();
      await new Promise((r) => setTimeout(r, 15));

      // Pictures go to Storage under the saved report's id, and the URLs they
      // come back with are what the published documents carry.
      expect(mockUploadReportPhotos).toHaveBeenCalledWith(
        expect.anything(),
        "report-1",
        pictures,
      );
      expect(getExportDocuments).toHaveBeenCalledWith(urls);
      expect(document.querySelector("#feedback").textContent).not.toContain("WARNING");
    });

    it("says so when a picture could not be uploaded", async () => {
      mockPublishBundle.mockResolvedValueOnce("bundle-token");
      const pictures = [
        { key: "1:photo:0", mimeType: "image/jpeg", bytes: new Uint8Array([1, 2]) },
        { key: "1:photo:1", mimeType: "image/jpeg", bytes: new Uint8Array([3, 4]) },
      ];
      // One upload rejected -- the save still succeeds, but the share will show
      // the reference sample's artwork for the picture that never arrived.
      mockUploadReportPhotos.mockResolvedValueOnce(
        new Map([["1:photo:0", "https://cdn/1_photo_0?token=t"]]),
      );

      document.body.innerHTML = WORKSPACE_DOM;
      mockSaveReport.mockResolvedValueOnce({ id: "report-1" });
      mockSaveReportDocuments.mockResolvedValueOnce(undefined);
      globalThis.docuAlignWorkspace = {
        getPublishableAssets: () => pictures,
        getExportDocuments: () => [{ slug: "X-1", title: "Test Report X-1", data: "{}" }],
      };
      await import("./save-report.js");
      if (authStateCallback) authStateCallback({ email: "docu@example.com" });
      document.querySelector("#cloud-save").click();
      await new Promise((r) => setTimeout(r, 15));

      const feedback = document.querySelector("#feedback").textContent;
      expect(feedback).toContain("Report saved with 1 documents");
      expect(feedback).toContain("1 of 2 photographs could not be uploaded");
      expect(feedback).toContain("Cloud Storage rules");
    });

    it("publishes a plain share when the report has no stored documents", async () => {
      mockPublishReport.mockResolvedValueOnce("share-token");

      await save([]);

      expect(mockPublishBundle).not.toHaveBeenCalled();
      expect(mockPublishReport).toHaveBeenCalledWith({}, expect.objectContaining({
        id: "report-1",
        reportName: "lab_report",
      }));
      expect(document.querySelector("#share-modal-link").textContent).toBe(SHARE_URL);
    });

    it("still reports the save when the share link cannot be published", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      mockPublishReport.mockRejectedValueOnce(new Error("denied"));

      await save([]);

      // The report really is saved, so the failure must not read as a save
      // failure -- and the modal, which only offers a link, stays shut.
      expect(document.querySelector("#feedback").textContent).toBe(
        "Report saved. View it anytime on the dashboard.",
      );
      expect(document.querySelector("#share-modal-backdrop").hidden).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(
        "[DocuAlign] Could not publish the saved report's share link",
        expect.objectContaining({ category: "SharePublishFailure" }),
      );
    });

    it("saves without a modal on a page that renders none", async () => {
      mockPublishReport.mockResolvedValueOnce("share-token");
      document.body.innerHTML = `
        <button id="cloud-save"></button>
        <span id="file-name">lab_report.xlsx</span>
        <div id="feedback"></div>
      `;
      mockSaveReport.mockResolvedValueOnce({ id: "report-1" });
      globalThis.docuAlignWorkspace = { getExportDocuments: () => [] };
      await import("./save-report.js");
      if (authStateCallback) authStateCallback({ email: "docu@example.com" });
      document.querySelector("#cloud-save").click();
      await new Promise((r) => setTimeout(r, 15));

      expect(document.querySelector("#feedback").textContent).toBe(
        "Report saved. View it anytime on the dashboard.",
      );
    });
  });
});
