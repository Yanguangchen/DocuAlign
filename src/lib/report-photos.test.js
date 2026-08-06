/**
 * @file report-photos.test.js
 * @description Coverage for the Cloud Storage upload that lets a public share
 * show the uploaded workbook's own photographs instead of the reference's.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRef = vi.fn((storage, path) => ({ path }));
const mockUploadBytes = vi.fn();
const mockGetDownloadURL = vi.fn();
vi.mock("firebase/storage", () => ({
  ref: (...args) => mockRef(...args),
  uploadBytes: (...args) => mockUploadBytes(...args),
  getDownloadURL: (...args) => mockGetDownloadURL(...args),
}));

const storage = {};

describe("report photos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockUploadBytes.mockResolvedValue(undefined);
    mockGetDownloadURL.mockImplementation(async (target) => `https://cdn/${target.path}?token=t`);
  });

  it("scopes every upload path to this app and sanitises the key", async () => {
    const { reportPhotoPath, REPORT_PHOTO_PREFIX } = await import("./report-photos.js");

    expect(REPORT_PHOTO_PREFIX).toBe("docuAlignReportPhotos");
    // The key carries colons, which are not safe in a storage path segment.
    expect(reportPhotoPath("report-1", "2:photo:0")).toBe(
      "docuAlignReportPhotos/report-1/2_photo_0",
    );
  });

  it("uploads each picture and maps its key to a download URL", async () => {
    const { uploadReportPhotos } = await import("./report-photos.js");
    const bytes = new Uint8Array([1, 2, 3]);

    const urls = await uploadReportPhotos(storage, "report-1", [
      { key: "1:photo:0", mimeType: "image/jpeg", bytes },
      { key: "1:preparedSignature", mimeType: "image/png", bytes },
    ]);

    expect(urls.get("1:photo:0")).toBe(
      "https://cdn/docuAlignReportPhotos/report-1/1_photo_0?token=t",
    );
    expect(urls.get("1:preparedSignature")).toBe(
      "https://cdn/docuAlignReportPhotos/report-1/1_preparedSignature?token=t",
    );
    // Pictures never change once written, so they are cached hard.
    expect(mockUploadBytes).toHaveBeenCalledWith(
      expect.anything(),
      bytes,
      expect.objectContaining({
        contentType: "image/jpeg",
        cacheControl: "public, max-age=31536000, immutable",
      }),
    );
  });

  it("falls back to a generic content type when the picture has none", async () => {
    const { uploadReportPhotos } = await import("./report-photos.js");

    await uploadReportPhotos(storage, "report-1", [
      { key: "1:photo:0", bytes: new Uint8Array([1]) },
    ]);

    expect(mockUploadBytes).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ contentType: "application/octet-stream" }),
    );
  });

  it("skips a picture that fails to upload rather than failing the save", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockUploadBytes
      .mockRejectedValueOnce(new Error("denied"))
      .mockResolvedValueOnce(undefined);
    const { uploadReportPhotos } = await import("./report-photos.js");

    const urls = await uploadReportPhotos(storage, "report-1", [
      { key: "1:photo:0", bytes: new Uint8Array([1]) },
      { key: "1:photo:1", bytes: new Uint8Array([2]) },
    ]);

    // The report is still saved; only that one picture loses its artwork.
    expect(urls.has("1:photo:0")).toBe(false);
    expect(urls.has("1:photo:1")).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      "[DocuAlign] Could not upload a report picture",
      expect.objectContaining({ category: "PhotoUploadFailure" }),
    );
  });

  it("does no work without a report id or any pictures", async () => {
    const { uploadReportPhotos } = await import("./report-photos.js");

    expect((await uploadReportPhotos(storage, "", [{ key: "a", bytes: new Uint8Array() }])).size)
      .toBe(0);
    expect((await uploadReportPhotos(storage, "report-1", [])).size).toBe(0);
    expect(mockUploadBytes).not.toHaveBeenCalled();
  });
});
