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

const mockSaveReport = vi.fn();
vi.mock("./lib/reports.js", () => ({
  saveReport: (...args) => mockSaveReport(...args),
}));

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
});
