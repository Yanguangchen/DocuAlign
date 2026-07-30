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
  const BODY_TOP = 352.1;
  const BODY_ROW_HEIGHT = 10.8;
  const REFERENCE_BODY_BOTTOM = 287;
  const TABLE_BOUNDARIES = Object.freeze([
    35.35,
    82.7,
    117.41,
    144.14,
    171.7,
    199.27,
    226.83,
    254.4,
    281.75,
    309.32,
    336.88,
    374.34,
    408.43,
    447.14,
    472.18,
    497.22,
    522.05,
    547.09,
    572.13,
    597.17,
    622.21,
    647.04,
    672.08,
    697.12,
    721.95,
    747.2,
    788.44,
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
    for (let row = 18; row <= 27; row += 1) {
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
      const left = TABLE_BOUNDARIES.at(slot);
      const right = TABLE_BOUNDARIES.at(slot + 1);
      whiteout(page, pdfLib, left + 0.6, 363.55, right - left - 1.2, 12.6);
      fittedText(page, text, left, right, 367.66, fonts.regular, 7.44, "center", pdfLib);
    });

    plan.limits.forEach((text, index) => {
      const slot = index + 3;
      const left = TABLE_BOUNDARIES.at(slot);
      const right = TABLE_BOUNDARIES.at(slot + 1);
      whiteout(page, pdfLib, left + 0.6, 352.65, right - left - 1.2, 9.7);
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
    const bodyBottom = BODY_TOP - rows.length * BODY_ROW_HEIGHT;
    const maskBottom = Math.min(REFERENCE_BODY_BOTTOM, bodyBottom) - 1;
    whiteout(
      page,
      pdfLib,
      TABLE_BOUNDARIES[0] - 1,
      maskBottom,
      TABLE_BOUNDARIES.at(-1) - TABLE_BOUNDARIES[0] + 2,
      BODY_TOP - maskBottom,
    );

    const lineColor = color(pdfLib, BLACK);
    const lineOptions = { thickness: 0.72, color: lineColor };
    for (let row = 0; row <= rows.length; row += 1) {
      const y = BODY_TOP - row * BODY_ROW_HEIGHT;
      page.drawLine({
        start: { x: TABLE_BOUNDARIES[0], y },
        end: { x: TABLE_BOUNDARIES.at(-1), y },
        ...lineOptions,
      });
    }
    TABLE_BOUNDARIES.forEach((x) => {
      page.drawLine({
        start: { x, y: bodyBottom },
        end: { x, y: BODY_TOP },
        ...lineOptions,
      });
    });

    rows.forEach((row, rowIndex) => {
      const baseline = 344.62 - rowIndex * BODY_ROW_HEIGHT;
      row.forEach((text, slot) => {
        const font = slot === 2 ? fonts.bold : fonts.regular;
        fittedText(
          page,
          text,
          TABLE_BOUNDARIES.at(slot),
          TABLE_BOUNDARIES.at(slot + 1),
          baseline,
          font,
          7.44,
          "center",
          pdfLib,
        );
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
    BODY_TOP,
    TABLE_BOUNDARIES,
    buildOverlayPlan,
    cellsFromDocumentData,
    createDocument,
  });
})();
