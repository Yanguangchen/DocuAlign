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
const rakReportSource = readFileSync(resolve(projectRoot, "src/rak-report-pdf.js"), "utf8");
const mappingSource = readFileSync(resolve(projectRoot, "src/report-mapping.js"), "utf8");
const zipWriterSource = readFileSync(resolve(projectRoot, "src/zip-writer.js"), "utf8");
const viewReportSource = readFileSync(resolve(projectRoot, "src/view-report.js"), "utf8");
const indexSource = readFileSync(resolve(projectRoot, "index.html"), "utf8");
const viewSource = readFileSync(resolve(projectRoot, "view.html"), "utf8");
const viteConfigSource = readFileSync(resolve(projectRoot, "vite.config.js"), "utf8");
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
  it("builds the test report from the reference asset and generates the rest", () => {
    // The CV1 + TR1 test report must keep its established layout, so it is
    // built by overlaying the uploaded values onto the reference pages rather
    // than being re-laid-out by the generic writer.
    expect(workspaceSource).toContain('REPORT_ASSET_PATH = "./SampleDocuments/SampleOutput.pdf"');
    expect(workspaceSource).toContain("docuAlignRakReportPdf.createRakReportPdf");
    expect(rakReportSource).toContain('TEMPLATE_PATH = "./SampleDocuments/SampleOutput.pdf"');
    // A workbook that cannot be mapped still falls back to the reference asset.
    expect(workspaceSource).toContain("document.assetPath = REPORT_ASSET_PATH");
    // Supporting worksheets are still generated.
    expect(workspaceSource).toContain("docuAlignPdf.createDocument");
    expect(workspaceSource).toContain("docuAlignSummaryPdf.createDocument");
  });

  it("loads the report mapping and overlay renderers on every runtime", () => {
    // Both are classic scripts so the workspace keeps working over file://,
    // and both must ship in the Vite build as well.
    expect(indexSource).toContain('src="./src/report-mapping.js"');
    expect(indexSource).toContain('src="./src/rak-report-pdf.js"');
    expect(viewSource).toContain('src="./src/rak-report-pdf.js"');
    expect(viteConfigSource).toContain('"report-mapping.js"');
    expect(viteConfigSource).toContain('"rak-report-pdf.js"');
    [rakReportSource, mappingSource].forEach((source) => {
      expect(source).not.toMatch(/^\s*(import|export)\s/m);
    });
  });

  it("keeps every document its own PDF, bundled into one archive to download", () => {
    // Documents stay separate files. The archive is only a wrapper so there is
    // one download and one browser prompt, in the Summary-first, then
    // sampling-date order DOCUMENT_KIND_ORDER and exportOrder decide.
    expect(workspaceSource).toContain("docuAlignZip.createArchive");
    expect(workspaceSource).toContain('download.download = `${baseName}.zip`');
    expect(workspaceSource).toContain("DOCUMENT_KIND_ORDER");
    expect(workspaceSource).toContain("exportOrder(documents)");
    // The public share viewer offers the same one-action download.
    expect(viewReportSource).toContain("docuAlignZip.createArchive");
    expect(viewReportSource).toContain('download.download = `${folderName}.zip`');
    expect(indexSource).toContain('src="./src/zip-writer.js"');
    expect(viewSource).toContain('src="./src/zip-writer.js"');
    expect(viteConfigSource).toContain('"zip-writer.js"');
    expect(zipWriterSource).not.toMatch(/^\s*(import|export)\s/m);
    // Nothing merges documents into a single PDF any more.
    expect(existsSync(resolve(projectRoot, "src/pdf-merge.js"))).toBe(false);
    expect(workspaceSource).not.toContain("docuAlignPdfMerge");
    expect(viewReportSource).not.toContain("docuAlignPdfMerge");
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
