import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  PUBLIC_SHARES_COLLECTION,
  PUBLIC_BUNDLES_COLLECTION,
  PUBLIC_PDF_PATH,
  SHARE_TOKEN_PATTERN,
  MAX_BUNDLE_REPORTS,
  generateShareToken,
  isValidShareToken,
  buildPublicUrl,
  buildBundleUrl,
  toPublicReportPayload,
  publishReport,
  publishBundle,
  fetchSharedReport,
  fetchSharedBundle,
} from "./share.js";
import * as firestore from "firebase/firestore";

vi.mock("firebase/firestore", () => ({
  doc: vi.fn((db, name, id) => ({ db, name, id })),
  getDoc: vi.fn(),
  setDoc: vi.fn(),
  serverTimestamp: vi.fn(() => "MOCK_TIMESTAMP"),
}));

const VALID_TOKEN = "aB3dEfGh1JkLmNoPqRsTuVwXyZ012345";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("share collection constants", () => {
  it("targets the dedicated public shares collection", () => {
    expect(PUBLIC_SHARES_COLLECTION).toBe("docuAlignPublicShares");
  });

  it("ties shares to the exported PDF asset path", () => {
    expect(PUBLIC_PDF_PATH).toBe("SampleDocuments/SampleOutput.pdf");
  });
});

describe("generateShareToken", () => {
  it("produces a 32 character URL-safe alphanumeric token", () => {
    const token = generateShareToken();
    expect(token).toMatch(SHARE_TOKEN_PATTERN);
    expect(token).toHaveLength(32);
    expect(encodeURIComponent(token)).toBe(token);
  });

  it("produces unique tokens across many generations", () => {
    const tokens = new Set(Array.from({ length: 200 }, generateShareToken));
    expect(tokens.size).toBe(200);
  });

  it("uses a cryptographically secure random source", () => {
    const spy = vi.spyOn(globalThis.crypto, "getRandomValues");
    generateShareToken();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("isValidShareToken", () => {
  it("accepts a well-formed 32 character token", () => {
    expect(isValidShareToken(VALID_TOKEN)).toBe(true);
    expect(isValidShareToken(generateShareToken())).toBe(true);
  });

  it("rejects wrong lengths, bad characters, and non-strings", () => {
    expect(isValidShareToken("")).toBe(false);
    expect(isValidShareToken("short")).toBe(false);
    expect(isValidShareToken(`${VALID_TOKEN}x`)).toBe(false);
    expect(isValidShareToken("../../../../etc/passwd0123456789")).toBe(false);
    expect(isValidShareToken(VALID_TOKEN.slice(0, 31) + "!")).toBe(false);
    expect(isValidShareToken(null)).toBe(false);
    expect(isValidShareToken(undefined)).toBe(false);
    expect(isValidShareToken(1234567890)).toBe(false);
    expect(isValidShareToken({ token: VALID_TOKEN })).toBe(false);
  });
});

describe("buildPublicUrl", () => {
  it("resolves view.html next to the current page", () => {
    expect(buildPublicUrl(VALID_TOKEN, "https://example.com/app/dashboard.html")).toBe(
      `https://example.com/app/view.html?share=${VALID_TOKEN}`,
    );
  });

  it("resolves from a directory root URL", () => {
    expect(buildPublicUrl(VALID_TOKEN, "https://example.com/")).toBe(
      `https://example.com/view.html?share=${VALID_TOKEN}`,
    );
  });

  it("throws on an invalid token so broken links are never handed out", () => {
    expect(() => buildPublicUrl("nope", "https://example.com/")).toThrow(TypeError);
  });
});

describe("toPublicReportPayload", () => {
  it("keeps only the public, non-PII report fields", () => {
    const payload = toPublicReportPayload({
      id: "doc-1",
      reportName: "rak-report",
      sourceFileName: "rak-report.xlsx",
      status: "complete",
      createdBy: "staff@rakmat.com.sg",
      createdAt: new Date("2026-06-15T10:00:00"),
      internalNote: "secret",
    });

    expect(payload).toEqual({
      reportId: "doc-1",
      reportName: "rak-report",
      sourceFileName: "rak-report.xlsx",
      status: "complete",
      pdfUrl: PUBLIC_PDF_PATH,
    });
    expect(payload).not.toHaveProperty("createdBy");
    expect(payload).not.toHaveProperty("internalNote");
  });

  it("applies dashboard-consistent fallbacks for missing metadata", () => {
    const payload = toPublicReportPayload({ id: "doc-2" });
    expect(payload).toEqual({
      reportId: "doc-2",
      reportName: "Untitled report",
      sourceFileName: null,
      status: "saved",
      pdfUrl: PUBLIC_PDF_PATH,
    });
  });

  it("falls back to the source file name for the report name", () => {
    const payload = toPublicReportPayload({ id: "doc-3", sourceFileName: "input.xlsx" });
    expect(payload.reportName).toBe("input.xlsx");
  });
});

describe("publishReport", () => {
  it("writes a sanitised snapshot keyed by a fresh token and returns the token", async () => {
    firestore.setDoc.mockResolvedValueOnce(undefined);
    const dummyDb = {};

    const token = await publishReport(dummyDb, {
      id: "doc-1",
      reportName: "rak-report",
      sourceFileName: "rak-report.xlsx",
      status: "complete",
      createdBy: "staff@rakmat.com.sg",
    });

    expect(isValidShareToken(token)).toBe(true);
    expect(firestore.doc).toHaveBeenCalledWith(dummyDb, PUBLIC_SHARES_COLLECTION, token);
    expect(firestore.setDoc).toHaveBeenCalledWith(
      { db: dummyDb, name: PUBLIC_SHARES_COLLECTION, id: token },
      {
        reportId: "doc-1",
        reportName: "rak-report",
        sourceFileName: "rak-report.xlsx",
        status: "complete",
        pdfUrl: PUBLIC_PDF_PATH,
        publishedAt: "MOCK_TIMESTAMP",
      },
    );
  });

  it("rejects reports without a saved document id", async () => {
    await expect(publishReport({}, { reportName: "unsaved" })).rejects.toThrow(TypeError);
    expect(firestore.setDoc).not.toHaveBeenCalled();
  });
});

describe("bundle constants", () => {
  it("targets the dedicated public bundles collection with a sane cap", () => {
    expect(PUBLIC_BUNDLES_COLLECTION).toBe("docuAlignPublicBundles");
    expect(MAX_BUNDLE_REPORTS).toBe(25);
  });
});

describe("buildBundleUrl", () => {
  it("resolves view.html with a bundle query next to the current page", () => {
    expect(buildBundleUrl(VALID_TOKEN, "https://example.com/app/dashboard.html")).toBe(
      `https://example.com/app/view.html?bundle=${VALID_TOKEN}`,
    );
  });

  it("throws on an invalid token", () => {
    expect(() => buildBundleUrl("nope", "https://example.com/")).toThrow(TypeError);
  });
});

describe("publishBundle", () => {
  const savedReports = [
    {
      id: "doc-1",
      reportName: "report-a",
      sourceFileName: "a.xlsx",
      status: "complete",
      createdBy: "staff@rakmat.com.sg",
    },
    { id: "doc-2", reportName: "report-b", status: "complete" },
  ];

  it("publishes one share per report plus a bundle of their tokens", async () => {
    firestore.setDoc.mockResolvedValue(undefined);
    const dummyDb = {};

    const token = await publishBundle(dummyDb, savedReports, { name: "Customer pack" });

    expect(isValidShareToken(token)).toBe(true);
    // Two single-share writes + one bundle write.
    expect(firestore.setDoc).toHaveBeenCalledTimes(3);

    const shareWrites = firestore.setDoc.mock.calls.filter(
      ([ref]) => ref.name === PUBLIC_SHARES_COLLECTION,
    );
    expect(shareWrites).toHaveLength(2);
    expect(shareWrites[0][1]).toMatchObject({ reportId: "doc-1", reportName: "report-a" });
    expect(shareWrites[1][1]).toMatchObject({ reportId: "doc-2", reportName: "report-b" });
    // PII never reaches any public document.
    expect(JSON.stringify(shareWrites)).not.toContain("staff@rakmat.com.sg");

    const [bundleRef, bundlePayload] = firestore.setDoc.mock.calls.find(
      ([ref]) => ref.name === PUBLIC_BUNDLES_COLLECTION,
    );
    expect(bundleRef).toEqual({ db: dummyDb, name: PUBLIC_BUNDLES_COLLECTION, id: token });
    expect(bundlePayload.bundleName).toBe("Customer pack");
    expect(bundlePayload.publishedAt).toBe("MOCK_TIMESTAMP");
    expect(bundlePayload.shareTokens).toEqual(shareWrites.map(([ref]) => ref.id));
    expect(bundlePayload.shareTokens.every(isValidShareToken)).toBe(true);
    expect(new Set(bundlePayload.shareTokens).size).toBe(2);
  });

  it("defaults the bundle name to null when omitted", async () => {
    firestore.setDoc.mockResolvedValue(undefined);
    await publishBundle({}, savedReports);
    const [, bundlePayload] = firestore.setDoc.mock.calls.find(
      ([ref]) => ref.name === PUBLIC_BUNDLES_COLLECTION,
    );
    expect(bundlePayload.bundleName).toBeNull();
  });

  it("rejects empty groups and groups above the cap without touching Firestore", async () => {
    await expect(publishBundle({}, [])).rejects.toThrow(TypeError);
    const tooMany = Array.from({ length: MAX_BUNDLE_REPORTS + 1 }, (_, i) => ({ id: `doc-${i}` }));
    await expect(publishBundle({}, tooMany)).rejects.toThrow(TypeError);
    await expect(publishBundle({}, "not-a-list")).rejects.toThrow(TypeError);
    expect(firestore.setDoc).not.toHaveBeenCalled();
  });

  it("rejects groups containing an unsaved report before any write", async () => {
    await expect(
      publishBundle({}, [{ id: "doc-1" }, { reportName: "unsaved" }]),
    ).rejects.toThrow(TypeError);
    expect(firestore.setDoc).not.toHaveBeenCalled();
  });
});

describe("fetchSharedBundle", () => {
  const TOKEN_A = "Aa3dEfGh1JkLmNoPqRsTuVwXyZ012345";
  const TOKEN_B = "Bb3dEfGh1JkLmNoPqRsTuVwXyZ012345";

  function mockBundleDoc(data) {
    firestore.getDoc.mockImplementation(async (ref) => {
      if (ref.name === PUBLIC_BUNDLES_COLLECTION) {
        return { exists: () => true, data: () => data };
      }
      if (ref.id === TOKEN_A) {
        return {
          exists: () => true,
          data: () => ({
            reportId: "doc-1",
            reportName: "report-a",
            status: "complete",
            pdfUrl: PUBLIC_PDF_PATH,
            publishedAt: { toDate: () => new Date("2026-06-15T10:00:00") },
          }),
        };
      }
      return { exists: () => false, data: () => undefined };
    });
  }

  it("resolves each linked share and drops revoked ones", async () => {
    const dummyDb = {};
    mockBundleDoc({
      bundleName: "Customer pack",
      shareTokens: [TOKEN_A, TOKEN_B],
      publishedAt: { toDate: () => new Date("2026-06-15T10:00:00") },
    });

    const bundle = await fetchSharedBundle(dummyDb, VALID_TOKEN);

    expect(firestore.doc).toHaveBeenCalledWith(dummyDb, PUBLIC_BUNDLES_COLLECTION, VALID_TOKEN);
    expect(bundle.token).toBe(VALID_TOKEN);
    expect(bundle.bundleName).toBe("Customer pack");
    expect(bundle.publishedAt).toEqual(new Date("2026-06-15T10:00:00"));
    // TOKEN_B was revoked (missing) so only report-a remains.
    expect(bundle.reports).toEqual([
      {
        token: TOKEN_A,
        reportId: "doc-1",
        reportName: "report-a",
        status: "complete",
        pdfUrl: PUBLIC_PDF_PATH,
        publishedAt: new Date("2026-06-15T10:00:00"),
      },
    ]);
  });

  it("defaults a malformed shareTokens field to an empty report list", async () => {
    mockBundleDoc({ bundleName: null, shareTokens: "corrupt", publishedAt: null });
    const bundle = await fetchSharedBundle({}, VALID_TOKEN);
    expect(bundle.reports).toEqual([]);
    expect(bundle.publishedAt).toBeNull();
  });

  it("returns null for missing documents and malformed tokens", async () => {
    firestore.getDoc.mockResolvedValueOnce({ exists: () => false, data: () => undefined });
    expect(await fetchSharedBundle({}, VALID_TOKEN)).toBeNull();

    expect(await fetchSharedBundle({}, "../sneaky")).toBeNull();
    expect(firestore.getDoc).toHaveBeenCalledTimes(1);
  });
});

describe("fetchSharedReport", () => {
  it("returns the share with a normalised publishedAt date", async () => {
    const dummyDb = {};
    firestore.getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        reportId: "doc-1",
        reportName: "rak-report",
        sourceFileName: "rak-report.xlsx",
        status: "complete",
        pdfUrl: PUBLIC_PDF_PATH,
        publishedAt: { toDate: () => new Date("2026-06-15T10:00:00") },
      }),
    });

    const share = await fetchSharedReport(dummyDb, VALID_TOKEN);

    expect(firestore.doc).toHaveBeenCalledWith(dummyDb, PUBLIC_SHARES_COLLECTION, VALID_TOKEN);
    expect(share).toEqual({
      token: VALID_TOKEN,
      reportId: "doc-1",
      reportName: "rak-report",
      sourceFileName: "rak-report.xlsx",
      status: "complete",
      pdfUrl: PUBLIC_PDF_PATH,
      publishedAt: new Date("2026-06-15T10:00:00"),
    });
  });

  it("returns null when the share document does not exist", async () => {
    firestore.getDoc.mockResolvedValueOnce({ exists: () => false, data: () => undefined });
    expect(await fetchSharedReport({}, VALID_TOKEN)).toBeNull();
  });

  it("returns null without touching Firestore for malformed tokens", async () => {
    expect(await fetchSharedReport({}, "../sneaky")).toBeNull();
    expect(await fetchSharedReport({}, "")).toBeNull();
    expect(await fetchSharedReport({}, null)).toBeNull();
    expect(firestore.getDoc).not.toHaveBeenCalled();
  });
});
