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
  "workbook-pdf.js",
  "report-mapping.js",
  "rak-report-pdf.js",
  "workspace.js",
];

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
    coverage: {
      provider: "v8",
      all: true,
      reporter: ["text", "json", "html"],
      include: ["src/**/*.{js,jsx}"],
      exclude: ["src/main.jsx", "src/**/*.test.{js,jsx}"]
    }
  }
});
