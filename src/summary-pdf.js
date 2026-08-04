/**
 * @file summary-pdf.js
 * @description Fixed-format renderer for the workbook's Summary worksheet.
 * The approved `sample_summary.pdf` page is copied unchanged, then only the
 * worksheet-driven metadata, limits, and result cells are replaced. Keeping
 * the reference page as the background preserves its branding, typography,
 * table header, spacing, and A4-landscape geometry exactly.
 *
 * This file intentionally remains classic-script compatible (no `import` /
 * `export`) so the renderer works when `index.html` is opened over `file://`.
 * It publishes its API on `globalThis.docuAlignSummaryPdf`.
 */
(function initSummaryPdf() {
  const TEMPLATE_PATH = "./SampleDocuments/sample_summary.pdf";
  const PAGE_COUNT = 1;
  const WHITE = Object.freeze([1, 1, 1]);
  const BLACK = Object.freeze([0, 0, 0]);

  /** Exact table geometry measured from `sample_summary.pdf`, in PDF points. */
  const BODY_ROW_HEIGHT = 10.8;
  const REFERENCE_BODY_BOTTOM = 287;

  /**
   * Table rule geometry, measured from the rules the reference page itself
   * draws. Every rule there is a filled rectangle 0.84pt thick, so the redrawn
   * body grid is drawn the same way and at the same coordinates -- stroking a
   * different weight, or leaving part of the reference's own rule underneath,
   * is what makes the finished table look unevenly ruled.
   *
   * Every mask and every value is bounded by these rules too, so replacing a
   * cell's contents cannot erase the lines that box it in.
   */
  const RULE_THICKNESS = 0.84;

  /** Bottom edge of the rule closing the header, which is the body's top rule. */
  const BODY_TOP_RULE = 352.03;

  /** Left edge of every vertical rule, in column order. */
  const TABLE_RULE_X = Object.freeze([
    36.12,
    83.4,
    118.08,
    144.86,
    172.34,
    199.82,
    227.3,
    254.78,
    282.26,
    309.77,
    337.25,
    374.57,
    408.65,
    447.31,
    472.27,
    497.23,
    522.19,
    547.15,
    572.11,
    597.1,
    622.06,
    647.02,
    671.98,
    696.94,
    721.9,
    746.88,
    788.16,
  ]);
  const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const SUMMARY_COLUMNS = new Set([...LETTERS, "AA"]);

  /**
   * Return one trimmed worksheet value.
   * @param {Map<string, string>} cells - Summary worksheet cell lookup.
   * @param {string} ref - A1 cell reference.
   * @returns {string} Display value.
   */
  function cellValue(cells, ref) {
    return String(cells.get(ref) ?? "").trim();
  }

  /**
   * Reapply a fixed-decimal Excel display format lost when OOXML cached values
   * are normalised by the dependency-free workbook reader.
   * @param {string} value - Normalised cell value.
   * @param {number} decimals - Required decimal places.
   * @returns {string} Excel-like display value.
   */
  function fixedDecimal(value, decimals) {
    if (value === "") return "";
    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(decimals) : value;
  }

  /**
   * Convert a zero-based column index into an Excel column label.
   * @param {number} index - Zero-based column index.
   * @returns {string} Excel column label.
   */
  function columnLabel(index) {
    if (index < LETTERS.length) return LETTERS.charAt(index);
    return `A${LETTERS.charAt(index - LETTERS.length)}`;
  }

  /**
   * Format one Summary result row exactly like the worksheet's cell formats.
   * @param {Map<string, string>} cells - Summary worksheet cell lookup.
   * @param {number} row - Worksheet row number.
   * @returns {string[]} The 26 visible result cells.
   */
  function resultRow(cells, row) {
    const values = [
      cellValue(cells, `A${row}`),
      cellValue(cells, `C${row}`),
      cellValue(cells, `D${row}`),
    ];

    for (let column = 4; column <= 10; column += 1) {
      values.push(cellValue(cells, `${columnLabel(column)}${row}`));
    }
    values.push(fixedDecimal(cellValue(cells, `L${row}`), 1));
    values.push(fixedDecimal(cellValue(cells, `M${row}`), 0));
    values.push(fixedDecimal(cellValue(cells, `N${row}`), 1));
    for (let column = 14; column <= 25; column += 1) {
      values.push(fixedDecimal(cellValue(cells, `${columnLabel(column)}${row}`), 1));
    }
    values.push(fixedDecimal(cellValue(cells, `AA${row}`), 2));
    return values;
  }

  /** First worksheet row of the Summary result table. */
  const FIRST_RESULT_ROW = 18;

  /**
   * Find the last worksheet row holding a result, so the rendered table follows
   * the uploaded file instead of stopping at the reference workbook's length.
   * @param {Map<string, string>} cells - Summary worksheet cell lookup.
   * @returns {number} Last populated row, or one below the first when empty.
   */
  function lastResultRow(cells) {
    let last = FIRST_RESULT_ROW - 1;
    for (const [ref, value] of cells) {
      if (String(value ?? "").trim() === "") continue;
      const row = Number(ref.match(/^[A-Z]{1,2}(\d+)$/)?.[1] ?? 0);
      if (row > last) last = row;
    }
    return last;
  }

  /**
   * Build the semantic overlay model for the fixed Summary template.
   * @param {Map<string, string>} cells - Summary worksheet cell lookup.
   * @returns {{metadata: Object, sieveSizes: string[], chemicalHeaders: string[], limits: string[], rows: string[][]}}
   * Worksheet values ready for positioned drawing.
   */
  function buildOverlayPlan(cells) {
    if (!(cells instanceof Map)) {
      throw new TypeError("Summary worksheet cells must be provided as a Map.");
    }

    const sieveSizes = [];
    for (let column = 4; column <= 10; column += 1) {
      sieveSizes.push(fixedDecimal(cellValue(cells, `${columnLabel(column)}16`), 2));
    }

    const limits = [];
    for (let column = 4; column <= 26; column += 1) {
      limits.push(cellValue(cells, `${columnLabel(column)}17`));
    }
    const chemicalHeaders = [];
    for (let column = 14; column <= 25; column += 1) {
      chemicalHeaders.push(cellValue(cells, `${columnLabel(column)}16`));
    }

    const rows = [];
    const finalRow = lastResultRow(cells);
    for (let row = FIRST_RESULT_ROW; row <= finalRow; row += 1) {
      const values = resultRow(cells, row);
      if (values.some((value) => value !== "")) rows.push(values);
    }

    return {
      metadata: {
        clientName: cellValue(cells, "F9"),
        addressLine1: cellValue(cells, "F10"),
        addressLine2: cellValue(cells, "F11"),
        projectTitle: cellValue(cells, "F12"),
        jobReference: cellValue(cells, "U10"),
        vesselName: cellValue(cells, "U11"),
        voyageNumber: cellValue(cells, "U12"),
      },
      sieveSizes,
      chemicalHeaders,
      limits,
      rows,
    };
  }

  /**
   * Reconstruct A1 cells from the dense grid stored by DocuAlign versions that
   * predate the fixed Summary renderer. The old grid omitted blank rows, so
   * anchor the metadata and table blocks by their stable worksheet labels.
   * @param {Array<Object>} sections - Legacy generic document sections.
   * @returns {Map<string, string>} Recovered Summary worksheet cells.
   */
  function cellsFromLegacySections(sections) {
    const section = sections.find((entry) => entry?.heading?.trim() === "Summary")
      ?? sections.at(0);
    if (!Array.isArray(section?.columns) || !Array.isArray(section?.rows)) {
      return new Map();
    }

    const metadataStart = section.rows.findIndex((row) =>
      Array.isArray(row) && row.includes("Client name:"),
    );
    const tableStart = section.rows.findIndex((row) =>
      Array.isArray(row) && row.includes("SAMPLING DATE"),
    );
    const rowMappings = [];

    if (metadataStart >= 0) {
      for (
        let index = metadataStart;
        index < Math.min(metadataStart + 4, section.rows.length);
        index += 1
      ) {
        rowMappings.push([index, 9 + index - metadataStart]);
      }
    }
    if (tableStart >= 0) {
      for (let index = tableStart; index < section.rows.length; index += 1) {
        rowMappings.push([index, 15 + index - tableStart]);
      }
    }

    const cells = new Map();
    rowMappings.forEach(([rowIndex, sourceRow]) => {
      const row = section.rows.at(rowIndex);
      section.columns.forEach((column, columnIndex) => {
        const value = row?.at(columnIndex);
        if (SUMMARY_COLUMNS.has(column) && value !== "" && value !== undefined) {
          cells.set(`${column}${sourceRow}`, String(value));
        }
      });
    });
    return cells;
  }

  /**
   * Decode either the current sparse-cell payload or a legacy generic grid.
   * This keeps already-saved Summary documents and existing package tokens
   * renderable after the fixed-format renderer is deployed.
   * @param {unknown} documentData - Parsed public `documentData` JSON.
   * @returns {Map<string, string>} Summary worksheet cells.
   */
  function cellsFromDocumentData(documentData) {
    if (documentData?.renderer === "summary" && Array.isArray(documentData.cells)) {
      return new Map(documentData.cells);
    }
    if (Array.isArray(documentData)) return cellsFromLegacySections(documentData);
    throw new TypeError("Summary document data is not a supported payload.");
  }

  /**
   * Convert an RGB tuple into pdf-lib's colour representation.
   * @param {object} pdfLib - pdf-lib browser or module API.
   * @param {number[]} components - Red, green, and blue values from 0 to 1.
   * @returns {object} pdf-lib RGB colour.
   */
  function color(pdfLib, components) {
    return pdfLib.rgb(components[0], components[1], components[2]);
  }

  /**
   * Paint a white rectangle over a template value.
   * @param {object} page - pdf-lib page.
   * @param {object} pdfLib - pdf-lib API.
   * @param {number} x - Left coordinate.
   * @param {number} y - Bottom coordinate.
   * @param {number} width - Rectangle width.
   * @param {number} height - Rectangle height.
   * @returns {void}
   */
  function whiteout(page, pdfLib, x, y, width, height) {
    page.drawRectangle({
      x,
      y,
      width,
      height,
      color: color(pdfLib, WHITE),
      borderWidth: 0,
    });
  }

  /**
   * Draw fitted text inside a bounded horizontal region.
   * @param {object} page - pdf-lib page.
   * @param {string} text - Text to draw.
   * @param {number} left - Region left edge.
   * @param {number} right - Region right edge.
   * @param {number} y - Text baseline.
   * @param {object} font - Embedded pdf-lib font.
   * @param {number} size - Preferred font size.
   * @param {"left"|"center"} align - Horizontal alignment.
   * @param {object} pdfLib - pdf-lib API.
   * @returns {void}
   */
  function fittedText(page, text, left, right, y, font, size, align, pdfLib) {
    const value = String(text);
    if (value === "") return;
    const available = Math.max(1, right - left - 2);
    const naturalWidth = font.widthOfTextAtSize(value, size);
    const fittedSize = naturalWidth > available
      ? Math.max(4.5, size * (available / naturalWidth))
      : size;
    const width = font.widthOfTextAtSize(value, fittedSize);
    const x = align === "center"
      ? left + Math.max(1, (right - left - width) / 2)
      : left + 1;
    page.drawText(value, {
      x,
      y,
      size: fittedSize,
      font,
      color: color(pdfLib, BLACK),
    });
  }

  /**
   * Replace the client and project values in the reference page.
   * @param {object} page - pdf-lib page.
   * @param {Object} metadata - Summary metadata.
   * @param {{regular: object, bold: object}} fonts - Embedded fonts.
   * @param {object} pdfLib - pdf-lib API.
   * @returns {void}
   */
  function drawMetadata(page, metadata, fonts, pdfLib) {
    const leftRows = [
      [metadata.clientName, 464.82],
      [metadata.addressLine1, 454.62],
      [metadata.addressLine2, 444.42],
      [metadata.projectTitle, 434.22],
    ];
    const rightRows = [
      [metadata.jobReference, 454.62, fonts.regular],
      [metadata.vesselName, 444.42, fonts.bold],
      [metadata.voyageNumber, 434.22, fonts.bold],
    ];

    leftRows.forEach(([text, y]) => {
      whiteout(page, pdfLib, 172, y - 2, 310, 10.4);
      fittedText(page, text, 173.4, 482, y, fonts.regular, 8.28, "left", pdfLib);
    });
    rightRows.forEach(([text, y, font]) => {
      whiteout(page, pdfLib, 597, y - 2, 116, 10.4);
      fittedText(page, text, 598, 713, y, font, 8.28, "left", pdfLib);
    });
  }

  /**
   * The interior of one table cell: the gap between its two vertical rules.
   *
   * Masks and text are both bounded by this, so replacing a cell's value can
   * never paint over the rules that box it in. Deriving the span from the text
   * boundaries instead erases them: those sit up to 1.2pt left of the rules.
   * @param {number} slot - Zero-based column index.
   * @returns {{left: number, right: number}} Inner edges of the cell.
   */
  function cellInterior(slot) {
    return {
      left: TABLE_RULE_X.at(slot) + RULE_THICKNESS,
      right: TABLE_RULE_X.at(slot + 1),
    };
  }

  /**
   * Replace worksheet-driven values in the two lower header rows.
   * @param {object} page - pdf-lib page.
   * @param {Object} plan - Summary overlay model.
   * @param {{regular: object, bold: object}} fonts - Embedded fonts.
   * @param {object} pdfLib - pdf-lib API.
   * @returns {void}
   */
  function drawHeaderValues(page, plan, fonts, pdfLib) {
    const sieveSlots = [3, 4, 5, 6, 7, 8, 9];
    const chemicalSlots = [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24];
    const headerValues = [
      ...sieveSlots.map((slot, index) => [slot, plan.sieveSizes.at(index)]),
      ...chemicalSlots.map((slot, index) => [slot, plan.chemicalHeaders.at(index)]),
    ];

    headerValues.forEach(([slot, text]) => {
      const { left, right } = cellInterior(slot);
      // The rule under this row spans 362.76 to 363.7. Starting the mask at
      // 363.55 clipped 0.15pt off its top, rendering it at 0.75 where every
      // other rule in the table is 0.88.
      whiteout(page, pdfLib, left, 363.7, right - left, 12.45);
      fittedText(page, text, left, right, 367.66, fonts.regular, 7.44, "center", pdfLib);
    });

    plan.limits.forEach((text, index) => {
      const slot = index + 3;
      const { left, right } = cellInterior(slot);
      whiteout(page, pdfLib, left, 352.65, right - left, 9.7);
      fittedText(page, text, left, right, 354.58, fonts.bold, 7.44, "center", pdfLib);
    });
  }

  /**
   * Replace the entire result body so the row count follows the uploaded file.
   * @param {object} page - pdf-lib page.
   * @param {string[][]} rows - Visible result rows.
   * @param {{regular: object, bold: object}} fonts - Embedded fonts.
   * @param {object} pdfLib - pdf-lib API.
   * @returns {void}
   */
  function drawResultBody(page, rows, fonts, pdfLib) {
    const bodyBottomRule = BODY_TOP_RULE - rows.length * BODY_ROW_HEIGHT;
    const gridLeft = TABLE_RULE_X[0];
    const gridWidth = TABLE_RULE_X.at(-1) + RULE_THICKNESS - gridLeft;
    // Clear the reference's own rules completely, the top one included: any
    // part left behind sits under the redrawn rule and thickens it.
    const maskTop = BODY_TOP_RULE + RULE_THICKNESS;
    const maskBottom = Math.min(REFERENCE_BODY_BOTTOM, bodyBottomRule) - 1;
    whiteout(page, pdfLib, gridLeft - 1, maskBottom, gridWidth + 2, maskTop - maskBottom);

    // Rules are filled rectangles, exactly as the reference page draws them,
    // so every rule in the finished table carries the same weight.
    const rule = (x, y, width, height) => page.drawRectangle({
      x,
      y,
      width,
      height,
      color: color(pdfLib, BLACK),
      borderWidth: 0,
    });

    for (let row = 0; row <= rows.length; row += 1) {
      rule(gridLeft, BODY_TOP_RULE - row * BODY_ROW_HEIGHT, gridWidth, RULE_THICKNESS);
    }
    TABLE_RULE_X.forEach((x) => {
      rule(x, bodyBottomRule, RULE_THICKNESS, BODY_TOP_RULE - bodyBottomRule + RULE_THICKNESS);
    });

    rows.forEach((row, rowIndex) => {
      const baseline = 344.62 - rowIndex * BODY_ROW_HEIGHT;
      row.forEach((text, slot) => {
        const font = slot === 2 ? fonts.bold : fonts.regular;
        const { left, right } = cellInterior(slot);
        fittedText(page, text, left, right, baseline, font, 7.44, "center", pdfLib);
      });
    });
  }

  /**
   * Decode the classic-script template payload used for direct `file://` runs.
   * @param {string} base64 - Base64-encoded PDF.
   * @returns {Uint8Array} Decoded PDF bytes.
   */
  function decodeBase64(base64) {
    const binary = globalThis.atob(base64);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  /**
   * Resolve the approved template from an injected test value, the embedded
   * direct-file payload, or the normal HTTP asset path.
   * @param {Object} options - Renderer options.
   * @returns {Promise<{bytes: ArrayBuffer|Uint8Array, source: string}>} Template.
   */
  async function resolveTemplate(options) {
    if (options.templateBytes) return { bytes: options.templateBytes, source: "injected" };
    if (typeof globalThis.docuAlignSummaryTemplateBase64 === "string") {
      return {
        bytes: decodeBase64(globalThis.docuAlignSummaryTemplateBase64),
        source: "embedded",
      };
    }

    const templateUrl = new URL(TEMPLATE_PATH, globalThis.location.href).href;
    const response = await (options.fetchImpl ?? globalThis.fetch)(templateUrl);
    if (!response.ok) {
      throw new Error(`Could not load the Summary PDF template (${response.status}).`);
    }
    return { bytes: await response.arrayBuffer(), source: "bundled" };
  }

  /**
   * Generate the one-page fixed-format Summary PDF.
   * @param {Map<string, string>} cells - Summary worksheet cells.
   * @param {{pdfLib?: object, templateBytes?: ArrayBuffer|Uint8Array, fetchImpl?: Function}} [options]
   * @returns {Promise<Uint8Array>} Generated PDF bytes.
   */
  async function createDocument(cells, options = {}) {
    const plan = buildOverlayPlan(cells);
    const pdfLib = Object.hasOwn(options, "pdfLib") ? options.pdfLib : globalThis.PDFLib;
    if (!pdfLib?.PDFDocument) {
      throw new Error("The Summary PDF template library is unavailable.");
    }

    const template = await resolveTemplate(options);
    const document = await pdfLib.PDFDocument.load(template.bytes);
    if (document.getPageCount() !== PAGE_COUNT) {
      throw new Error("The Summary PDF template must contain exactly one page.");
    }

    const fonts = {
      regular: await document.embedFont(pdfLib.StandardFonts.Helvetica),
      bold: await document.embedFont(pdfLib.StandardFonts.HelveticaBold),
    };
    const page = document.getPage(0);
    drawMetadata(page, plan.metadata, fonts, pdfLib);
    drawHeaderValues(page, plan, fonts, pdfLib);
    drawResultBody(page, plan.rows, fonts, pdfLib);
    const bytes = await document.save();

    globalThis.docuAlignLogger?.logInfo?.("Summary PDF template rendering completed", {
      feature: "SummaryPdf",
      function: "createDocument",
      operation: "pdf.copyAndOverlaySummary",
      category: "LocalPdfGeneration",
      templateSource: template.source,
      pageCount: PAGE_COUNT,
      rowCount: plan.rows.length,
      outputBytes: bytes.length,
    });
    return bytes;
  }

  globalThis.docuAlignSummaryPdf = Object.freeze({
    BODY_ROW_HEIGHT,
    BODY_TOP_RULE,
    RULE_THICKNESS,
    TABLE_RULE_X,
    buildOverlayPlan,
    cellsFromDocumentData,
    createDocument,
  });
})();
