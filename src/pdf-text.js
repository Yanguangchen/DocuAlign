/**
 * @file pdf-text.js
 * @description Shared text drawing for the two pdf-lib overlay renderers
 * (`summary-pdf.js` and `rak-report-pdf.js`).
 *
 * Both draw worksheet values with the standard Helvetica faces, whose WinAnsi
 * encoding covers Latin-1 and nothing beyond it. A `°` fits; `≤` and `≥` do
 * not, and pdf-lib refuses the whole page rather than dropping the character.
 * The lab's own limits carry both symbols, so text is split into runs here and
 * the few characters WinAnsi cannot encode are drawn from the standard Symbol
 * font, which can. Text without them stays one run drawn exactly as before.
 *
 * This file intentionally remains classic-script compatible (no `import` /
 * `export`) so both renderers keep working when `index.html` and `view.html`
 * are opened over `file://`. It publishes its API on `globalThis.docuAlignPdfText`.
 */
(function initPdfText() {
  /**
   * The characters the Symbol font draws because WinAnsi cannot encode them.
   *
   * Deliberately tiny: every addition costs the glyph its surrounding weight,
   * since Symbol ships in one face and has no bold. These two are worth that —
   * `≤` and `≥` carry the limit's meaning, and drawing `<` in their place
   * states a different specification than the one the lab certified.
   */
  const SYMBOL_CHARACTERS = new Set(["≤", "≥"]);

  /**
   * Split text into consecutive runs, each drawn with a font that can encode it.
   * @param {string} text - Text to draw.
   * @param {object} font - Embedded pdf-lib font for ordinary characters.
   * @param {object} symbolFont - Embedded pdf-lib Symbol font.
   * @returns {Array<{text: string, font: object}>} Runs in drawing order.
   */
  function fontRuns(text, font, symbolFont) {
    const runs = [];
    for (const character of String(text)) {
      const runFont = SYMBOL_CHARACTERS.has(character) ? symbolFont : font;
      const last = runs.at(-1);
      if (last?.font === runFont) last.text += character;
      else runs.push({ text: character, font: runFont });
    }
    return runs;
  }

  /**
   * Measure the runs the way `widthOfTextAtSize` measures a single string, so
   * fitting and alignment stay correct across a font change.
   * @param {Array<{text: string, font: object}>} runs - Runs to measure.
   * @param {number} size - Font size in points.
   * @returns {number} Total advance width in points.
   */
  function runsWidth(runs, size) {
    return runs.reduce((total, run) => total + run.font.widthOfTextAtSize(run.text, size), 0);
  }

  /**
   * Draw runs left to right from one origin, advancing by each run's own width.
   * @param {object} page - pdf-lib page.
   * @param {Array<{text: string, font: object}>} runs - Runs to draw.
   * @param {object} options - pdf-lib `drawText` options; `font` is per run.
   * @returns {void}
   */
  function drawRuns(page, runs, options) {
    let x = options.x;
    runs.forEach((run) => {
      page.drawText(run.text, { ...options, x, font: run.font });
      x += run.font.widthOfTextAtSize(run.text, options.size);
    });
  }

  globalThis.docuAlignPdfText = Object.freeze({
    SYMBOL_CHARACTERS,
    drawRuns,
    fontRuns,
    runsWidth,
  });
})();
