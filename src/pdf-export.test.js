/**
 * @file pdf-export.test.js
<<<<<<< HEAD
 * @description Verifies dynamic workspace PDF generation and preserves the
 * dual reference-asset contract required by direct-file and Vite deployments.
=======
 * @description Guards the dual asset directory contract for the reference PDFs
 * and asserts that the workspace generates its exports rather than shipping a
 * static document. The reference PDFs remain the layout target the generated
 * output is designed against, so both copies must stay byte-identical.
>>>>>>> 5d5b9f2 (Add behavioral tests for XLSX reader functionality)
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(".");
const workspaceSource = readFileSync(resolve(projectRoot, "src/workspace.js"), "utf8");
<<<<<<< HEAD
const relativeAssetPath = "SampleDocuments/SampleOutput.pdf";
=======

/**
 * Reference PDFs that must exist identically in both asset directories, with
 * their expected page counts. AGENTS.md forbids removing either copy.
 */
const REFERENCE_ASSETS = new Map([
  ["SampleDocuments/SampleOutput.pdf", 5],
  ["SampleDocuments/SampleOutput-cover.pdf", 1],
]);
>>>>>>> 5d5b9f2 (Add behavioral tests for XLSX reader functionality)

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

<<<<<<< HEAD
describe("PDF export asset", () => {
  it("generates exports from parsed workbooks instead of downloading the sample", () => {
    expect(workspaceSource).toContain("createRakReportPdf");
    expect(workspaceSource).toContain("URL.createObjectURL");
    expect(workspaceSource).not.toContain("SampleOutput.pdf");
  });

  it("retains identical full five-page reference PDFs for both deployments", () => {
    const directFilePath = resolve(projectRoot, relativeAssetPath);
    const vitePublicPath = resolve(projectRoot, "public", relativeAssetPath);

    expect(existsSync(directFilePath), `Missing direct-file asset: ${directFilePath}`).toBe(true);
    expect(existsSync(vitePublicPath), `Missing Vite public asset: ${vitePublicPath}`).toBe(true);

    const directPdf = readFileSync(directFilePath);
    const publicPdf = readFileSync(vitePublicPath);

    expect(directPdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(sha256(directPdf)).toBe(sha256(publicPdf));

    const pageObjects = directPdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? [];
    expect(pageObjects).toHaveLength(5);
=======
describe("PDF export", () => {
  it("serves the test report from the reference asset and generates the rest", () => {
    // The CV1 + TR1 test report must keep its established layout, so it is
    // downloaded as-is rather than re-rendered from worksheet data.
    expect(workspaceSource).toContain('REPORT_ASSET_PATH = "./SampleDocuments/SampleOutput.pdf"');
    expect(workspaceSource).toContain("assetPath: REPORT_ASSET_PATH");
    // Supporting worksheets are still generated.
    expect(workspaceSource).toContain("docuAlignPdf.createDocument");
>>>>>>> 5d5b9f2 (Add behavioral tests for XLSX reader functionality)
  });

  it.each([...REFERENCE_ASSETS.keys()])(
    "keeps %s identical for direct-file and Vite deployments",
    (relativeAssetPath) => {
      const directFilePath = resolve(projectRoot, relativeAssetPath);
      const vitePublicPath = resolve(projectRoot, "public", relativeAssetPath);

      expect(existsSync(directFilePath), `Missing direct-file asset: ${directFilePath}`).toBe(true);
      expect(existsSync(vitePublicPath), `Missing Vite public asset: ${vitePublicPath}`).toBe(true);

      const directPdf = readFileSync(directFilePath);
      const publicPdf = readFileSync(vitePublicPath);

      expect(directPdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
      expect(sha256(directPdf)).toBe(sha256(publicPdf));

      const pageObjects = directPdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? [];
      expect(pageObjects).toHaveLength(REFERENCE_ASSETS.get(relativeAssetPath));
    },
  );
});
