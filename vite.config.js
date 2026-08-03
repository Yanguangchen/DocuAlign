/**
 * @file vite.config.js
 * @description Vite build, test, and coverage configuration for DocuAlign,
 * including emission of classic scripts required by direct-file execution.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const classicScripts = [
  "early-observability.js",
  "xlsx-reader.js",
  "pdf-writer.js",
  "summary-pdf.js",
  "report-mapping.js",
  "rak-report-pdf.js",
  "workspace.js",
];

const classicVendorAssets = ["pdf-lib.min.js", "sample-summary-template.js"];

function emitClassicScripts() {
  return {
    name: "docualign-classic-scripts",
    apply: "build",
    async buildStart() {
      for (const fileName of classicScripts) {
        this.emitFile({
          type: "asset",
          fileName: `src/${fileName}`,
          source: await readFile(resolve(import.meta.dirname, "src", fileName)),
        });
      }
      for (const fileName of classicVendorAssets) {
        this.emitFile({
          type: "asset",
          fileName: `vendor/${fileName}`,
          source: await readFile(resolve(import.meta.dirname, "vendor", fileName)),
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), emitClassicScripts()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        dashboard: resolve(import.meta.dirname, "dashboard.html"),
        view: resolve(import.meta.dirname, "view.html"),
      },
    },
  },
  test: {
    globals: true,
    environment: "happy-dom",
    // PDF template copies are intentionally byte-for-byte and can exceed the
    // default timeout when V8 coverage instrumentation is enabled. Every
    // report is now overlaid from its own workbook values, embedding that
    // group's photographs rather than copying the reference pages untouched,
    // so a single template render is heavier than it once was.
    testTimeout: 30000,
    coverage: {
      provider: "v8",
      all: true,
      reporter: ["text", "json", "html"],
      include: ["src/**/*.{js,jsx}"],
      exclude: ["src/main.jsx", "src/**/*.test.{js,jsx}"]
    }
  }
});
