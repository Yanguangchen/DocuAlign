/**
 * @file pdf-text.test.js
 * @description Covers the shared font-run splitting both pdf-lib overlay
 * renderers draw through, so a limit carrying a symbol WinAnsi cannot encode
 * is still measured, placed, and drawn where the reference page puts it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Widths that make each run's advance obvious in an assertion. */
function stubFont(name, widthPerCharacter) {
  return {
    name,
    widthOfTextAtSize: (text, size) => text.length * widthPerCharacter * size,
  };
}

const helvetica = stubFont("Helvetica", 1);
const symbol = stubFont("Symbol", 2);

let pdfText;

beforeEach(async () => {
  vi.resetModules();
  delete globalThis.docuAlignPdfText;
  await import("./pdf-text.js");
  pdfText = globalThis.docuAlignPdfText;
});

describe("shared PDF text runs", () => {
  it("leaves text the standard fonts can encode as a single run", () => {
    const runs = pdfText.fontRuns("32° - 45°", helvetica, symbol);

    expect(runs).toEqual([{ text: "32° - 45°", font: helvetica }]);
    expect(pdfText.runsWidth(runs, 10)).toBe(90);
  });

  it("splits only the characters WinAnsi cannot encode onto the Symbol font", () => {
    expect(pdfText.fontRuns("≤ 15%", helvetica, symbol)).toEqual([
      { text: "≤", font: symbol },
      { text: " 15%", font: helvetica },
    ]);
    expect(pdfText.fontRuns("32≥x≤", helvetica, symbol)).toEqual([
      { text: "32", font: helvetica },
      { text: "≥", font: symbol },
      { text: "x", font: helvetica },
      { text: "≤", font: symbol },
    ]);
    expect([...pdfText.SYMBOL_CHARACTERS]).toEqual(["≤", "≥"]);
  });

  it("measures a split value as the sum of its runs' own advances", () => {
    const runs = pdfText.fontRuns("≤ 15%", helvetica, symbol);

    // One Symbol character at double width, then four Helvetica ones.
    expect(pdfText.runsWidth(runs, 10)).toBe(20 + 40);
  });

  it("draws each run from where the previous one ended, keeping the options", () => {
    const drawn = [];
    const page = { drawText: (text, options) => drawn.push({ text, ...options }) };

    pdfText.drawRuns(page, pdfText.fontRuns("≤ 15%", helvetica, symbol), {
      x: 100,
      y: 50,
      size: 10,
      font: helvetica,
      color: "black",
    });

    expect(drawn).toEqual([
      { text: "≤", x: 100, y: 50, size: 10, font: symbol, color: "black" },
      { text: " 15%", x: 120, y: 50, size: 10, font: helvetica, color: "black" },
    ]);
  });

  it("draws nothing for empty text", () => {
    const page = { drawText: vi.fn() };

    pdfText.drawRuns(page, pdfText.fontRuns("", helvetica, symbol), {
      x: 0,
      y: 0,
      size: 10,
      font: helvetica,
    });

    expect(page.drawText).not.toHaveBeenCalled();
  });
});
