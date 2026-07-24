/**
 * @file classic-runtime.test.js
 * @description Protects the classic-script loading contract that keeps early
 * observability and workspace/PDF behavior available under direct `file://`.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(".");
const pages = ["index.html", "dashboard.html", "view.html"];

function readProjectFile(path) {
  return readFileSync(resolve(projectRoot, path), "utf8");
}

describe("classic runtime assets", () => {
  it("loads early observability before page modules on every page", () => {
    for (const page of pages) {
      const html = readProjectFile(page);
      const bootstrap = html.indexOf('src="./src/early-observability.js"');
      const firstModule = html.indexOf('type="module"');

      expect(bootstrap, `${page} must load early observability`).toBeGreaterThan(-1);
      expect(bootstrap, `${page} must bootstrap before modules`).toBeLessThan(firstModule);
    }
  });

  it("loads workbook processing before the workspace controller and Firebase modules", () => {
    const html = readProjectFile("index.html");
    const pdfLib = html.indexOf('<script vite-ignore src="./vendor/pdf-lib.min.js"></script>');
    const workbookPdf = html.indexOf('<script vite-ignore src="./src/workbook-pdf.js"></script>');
    const reportMapping = html.indexOf(
      '<script vite-ignore src="./src/report-mapping.js"></script>',
    );
    const reportPdf = html.indexOf(
      '<script vite-ignore src="./src/rak-report-pdf.js"></script>',
    );
    const workspace = html.indexOf('<script vite-ignore src="./src/workspace.js"></script>');
    const firstModule = html.indexOf('<script type="module"');

    expect(pdfLib).toBeGreaterThan(-1);
    expect(workbookPdf).toBeGreaterThan(pdfLib);
    expect(reportMapping).toBeGreaterThan(workbookPdf);
    expect(reportPdf).toBeGreaterThan(reportMapping);
    expect(workspace).toBeGreaterThan(-1);
    expect(reportPdf).toBeLessThan(workspace);
    expect(workspace).toBeLessThan(firstModule);
  });

  it("keeps direct-file controllers free of module-only syntax", () => {
    for (const file of [
      "src/early-observability.js",
      "src/workbook-pdf.js",
      "src/report-mapping.js",
      "src/rak-report-pdf.js",
      "src/workspace.js",
    ]) {
      const source = readProjectFile(file);
      expect(source, `${file} must not import modules`).not.toMatch(/^\s*import\s/m);
      expect(source, `${file} must not export bindings`).not.toMatch(/^\s*export\s/m);
    }
  });
});
