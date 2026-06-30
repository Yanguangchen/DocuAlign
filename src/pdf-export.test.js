import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(".");
const indexHtml = readFileSync(resolve(projectRoot, "index.html"), "utf8");
const exportUrlMatch = indexHtml.match(
  /new URL\("(\.\/SampleDocuments\/[^"?]+\.pdf)", window\.location\.href\)/,
);

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

describe("PDF export asset", () => {
  it("resolves to identical one-page PDFs for direct-file and Vite deployments", () => {
    expect(exportUrlMatch, "index.html must declare a relative PDF export URL").not.toBeNull();

    const relativeAssetPath = exportUrlMatch[1].replace(/^\.\//, "");
    const directFilePath = resolve(projectRoot, relativeAssetPath);
    const vitePublicPath = resolve(projectRoot, "public", relativeAssetPath);

    expect(existsSync(directFilePath), `Missing direct-file asset: ${directFilePath}`).toBe(true);
    expect(existsSync(vitePublicPath), `Missing Vite public asset: ${vitePublicPath}`).toBe(true);

    const directPdf = readFileSync(directFilePath);
    const publicPdf = readFileSync(vitePublicPath);

    expect(directPdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(sha256(directPdf)).toBe(sha256(publicPdf));

    const pageObjects = directPdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? [];
    expect(pageObjects).toHaveLength(1);
  });
});
