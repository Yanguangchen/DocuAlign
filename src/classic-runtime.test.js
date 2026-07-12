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

  it("loads the workspace controller as a classic script before Firebase modules", () => {
    const html = readProjectFile("index.html");
    const workspace = html.indexOf('<script vite-ignore src="./src/workspace.js"></script>');
    const firstModule = html.indexOf('<script type="module"');

    expect(workspace).toBeGreaterThan(-1);
    expect(workspace).toBeLessThan(firstModule);
  });

  it("keeps both direct-file scripts free of module-only syntax", () => {
    for (const file of ["src/early-observability.js", "src/workspace.js"]) {
      const source = readProjectFile(file);
      expect(source, `${file} must not import modules`).not.toMatch(/^\s*import\s/m);
      expect(source, `${file} must not export bindings`).not.toMatch(/^\s*export\s/m);
    }
  });
});
