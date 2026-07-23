/**
 * @file pdf-export.test.js
 * @description Verifies dynamic workspace PDF generation and preserves the
 * dual reference-asset contract required by direct-file and Vite deployments.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(".");
const workspaceSource = readFileSync(resolve(projectRoot, "src/workspace.js"), "utf8");
const relativeAssetPath = "SampleDocuments/SampleOutput.pdf";

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

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
  });
});
