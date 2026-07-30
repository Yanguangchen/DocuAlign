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

  it("loads fixed-format PDF dependencies before each consuming controller", () => {
    for (const page of ["index.html", "view.html"]) {
      const html = readProjectFile(page);
      const pdfLib = html.indexOf('<script vite-ignore src="./vendor/pdf-lib.min.js"></script>');
      const template = html.indexOf(
        '<script vite-ignore src="./vendor/sample-summary-template.js"></script>',
      );
      const summaryPdf = html.indexOf('<script vite-ignore src="./src/summary-pdf.js"></script>');
      const consumer = page === "index.html"
        ? html.indexOf('<script vite-ignore src="./src/workspace.js"></script>')
        : html.indexOf('<script type="module" src="./src/view-report.js"></script>');

      expect(pdfLib, `${page} must load pdf-lib`).toBeGreaterThan(-1);
      expect(template, `${page} must load the Summary template`).toBeGreaterThan(pdfLib);
      expect(summaryPdf, `${page} must load the Summary renderer`).toBeGreaterThan(template);
      expect(consumer, `${page} must load its consumer`).toBeGreaterThan(summaryPdf);
    }
  });

  it("keeps direct-file scripts free of module-only syntax", () => {
    for (const file of [
      "src/early-observability.js",
      "src/xlsx-reader.js",
      "src/pdf-writer.js",
      "src/summary-pdf.js",
      "src/workspace.js",
    ]) {
      const source = readProjectFile(file);
      expect(source, `${file} must not import modules`).not.toMatch(/^\s*import\s/m);
      expect(source, `${file} must not export bindings`).not.toMatch(/^\s*export\s/m);
    }
  });
});
