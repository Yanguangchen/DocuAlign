/**
 * @file pdf-export.test.js
 * @description Guards the dual asset directory contract for the reference PDFs
 * and asserts that the workspace generates its exports rather than shipping a
 * static document. The reference PDFs remain the layout target the generated
 * output is designed against, so both copies must stay byte-identical.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(".");
const workspaceSource = readFileSync(resolve(projectRoot, "src/workspace.js"), "utf8");
const embeddedSummarySource = readFileSync(
  resolve(projectRoot, "vendor/sample-summary-template.js"),
  "utf8",
);

/**
 * Reference PDFs that must exist identically in both asset directories, with
 * their expected page counts. AGENTS.md forbids removing either copy.
 */
const REFERENCE_ASSETS = new Map([
  ["SampleDocuments/SampleOutput.pdf", 5],
  ["SampleDocuments/SampleOutput-cover.pdf", 1],
  ["SampleDocuments/sample_summary.pdf", 1],
]);

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

describe("PDF export", () => {
  it("serves the test report from the reference asset and generates the rest", () => {
    // The CV1 + TR1 test report must keep its established layout, so it is
    // downloaded as-is rather than re-rendered from worksheet data.
    expect(workspaceSource).toContain('REPORT_ASSET_PATH = "./SampleDocuments/SampleOutput.pdf"');
    expect(workspaceSource).toContain("assetPath: REPORT_ASSET_PATH");
    // Supporting worksheets are still generated.
    expect(workspaceSource).toContain("docuAlignPdf.createDocument");
    expect(workspaceSource).toContain("docuAlignSummaryPdf.createDocument");
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

  it("embeds the approved Summary template byte-for-byte for direct-file use", () => {
    const encoded = embeddedSummarySource.match(
      /docuAlignSummaryTemplateBase64 = "([A-Za-z0-9+/=]+)";/,
    )?.[1];
    expect(encoded).toBeTruthy();

    const embeddedPdf = Buffer.from(encoded, "base64");
    const referencePdf = readFileSync(
      resolve(projectRoot, "SampleDocuments/sample_summary.pdf"),
    );
    expect(sha256(embeddedPdf)).toBe(sha256(referencePdf));
  });
});
