/**
 * @file pdf-writer.js
 * @description Dependency-free PDF generator for DocuAlign exports. Renders
 * worksheet-derived tables into a PDF 1.4 document using the standard Helvetica
 * fonts, so no font embedding, external service, or third-party library is
 * required.
 *
 * This file intentionally remains classic-script compatible (no `import` /
 * `export`) so the workspace keeps working over `file://`, matching the
 * dual-environment contract in AGENTS.md. It publishes its API on
 * `globalThis.docuAlignPdf`.
 */
(function initPdfWriter() {
  /** A4 landscape, in PDF points; worksheet tables are far wider than tall. */
  const PAGE_WIDTH = 842;
  const PAGE_HEIGHT = 595;
  const MARGIN = 36;

  const TITLE_SIZE = 15;
  const HEADING_SIZE = 10;
  const CELL_SIZE = 7;
  const LINE_HEIGHT = 11;

  /** Helvetica averages close to half the point size per character. */
  const CHAR_WIDTH_RATIO = 0.5;
  const MIN_COLUMN_CHARS = 3;

  const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

  /**
   * Escape a string for inclusion in a PDF literal string, dropping characters
   * the WinAnsi-compatible standard fonts cannot represent.
   * @param {string} value - Raw text.
   * @returns {string} Escaped, latin1-safe text.
   */
  function escapeText(value) {
    let escaped = "";
    for (const character of String(value)) {
      const code = character.codePointAt(0);
      if (code > 255) escaped += "?";
      else if (character === "\\" || character === "(" || character === ")") {
        escaped += `\\${character}`;
      } else if (code < 32) escaped += " ";
      else escaped += character;
    }
    return escaped;
  }

  /**
   * Truncate text to the number of characters that fit a column.
   * @param {string} value - Raw text.
   * @param {number} width - Column width in points.
   * @returns {string} Text clipped to the available width.
   */
  function clipText(value, width) {
    const maxChars = Math.max(1, Math.floor(width / (CELL_SIZE * CHAR_WIDTH_RATIO)));
    const text = String(value);
    // The marker stays ASCII; the standard fonts cannot render a true ellipsis.
    return text.length <= maxChars ? text : `${text.slice(0, Math.max(1, maxChars - 2))}..`;
  }

  /**
   * Emit a positioned run of text as PDF content-stream operators.
   * @param {string} font - Font resource name (`F1` or `F2`).
   * @param {number} size - Font size in points.
   * @param {number} x - Left edge in points.
   * @param {number} y - Baseline in points.
   * @param {string} text - Text to draw.
   * @returns {string} Content stream fragment.
   */
  function drawText(font, size, x, y, text) {
    return `BT /${font} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${escapeText(text)}) Tj ET\n`;
  }

  /**
   * Emit a horizontal rule.
   * @param {number} y - Vertical position in points.
   * @returns {string} Content stream fragment.
   */
  function drawRule(y) {
    return `0.6 w ${MARGIN} ${y.toFixed(2)} m ${PAGE_WIDTH - MARGIN} ${y.toFixed(2)} l S\n`;
  }

  /* eslint-disable security/detect-object-injection -- Numeric table indices
     only; every index comes from array iteration or column arithmetic. */

  /**
   * Allocate column widths proportionally to their widest cell, so dense
   * worksheet columns stay readable instead of every column sharing the page
   * equally.
   * @param {Array<string[]>} rows - Table rows.
   * @param {string[]} headers - Column headers.
   * @returns {number[]} Column widths in points.
   */
  function measureColumns(rows, headers) {
    const lengths = headers.map((header) => Math.max(MIN_COLUMN_CHARS, String(header).length));
    rows.forEach((row) => {
      row.forEach((cell, index) => {
        if (index < lengths.length) {
          lengths[index] = Math.max(lengths[index], String(cell ?? "").length);
        }
      });
    });

    const total = lengths.reduce((sum, length) => sum + length, 0) || 1;
    return lengths.map((length) => (length / total) * CONTENT_WIDTH);
  }

  /**
   * Lay a section's rows out across as many pages as they need.
   * @param {Object} section - Section descriptor.
   * @param {Object} state - Mutable pagination state.
   * @returns {void}
   */
  function renderSection(section, state) {
    const headers = section.columns ?? [];
    const rows = section.rows ?? [];
    const widths = measureColumns(rows, headers);
    const offsets = [];
    widths.reduce((cursor, width) => {
      offsets.push(cursor);
      return cursor + width;
    }, MARGIN);

    /**
     * Draw the section heading plus column headers at the current cursor.
     * @returns {void}
     */
    function openBlock() {
      state.ensureRoom(LINE_HEIGHT * 3);
      state.write(drawText("F2", HEADING_SIZE, MARGIN, state.y, section.heading));
      state.y -= LINE_HEIGHT * 1.4;

      headers.forEach((header, index) => {
        state.write(
          drawText("F2", CELL_SIZE, offsets[index], state.y, clipText(header, widths[index])),
        );
      });
      state.y -= 3;
      state.write(drawRule(state.y));
      state.y -= LINE_HEIGHT;
    }

    openBlock();
    rows.forEach((row) => {
      if (state.y < MARGIN + LINE_HEIGHT) {
        state.newPage();
        openBlock();
      }
      row.forEach((cell, index) => {
        if (index >= widths.length || cell === "" || cell === undefined) return;

        // Spreadsheet labels routinely spill across the blank cells beside them,
        // so a value may use the run of empty columns that follows it.
        let end = index + 1;
        while (end < widths.length && (row[end] === "" || row[end] === undefined)) end += 1;
        const available =
          (end < widths.length ? offsets[end] : PAGE_WIDTH - MARGIN) - offsets[index];

        state.write(drawText("F1", CELL_SIZE, offsets[index], state.y, clipText(cell, available)));
      });
      state.y -= LINE_HEIGHT;
    });
    state.y -= LINE_HEIGHT;
  }

  /* eslint-enable security/detect-object-injection */

  /**
   * Render a document made of titled worksheet sections into PDF bytes.
   * @param {{title: string, subtitle?: string, sections: Array<{heading: string, columns: string[], rows: Array<string[]>}>}} document - Document spec.
   * @returns {Uint8Array} The complete PDF file.
   */
  function createDocument(document) {
    const pages = [];
    const state = {
      y: 0,
      buffer: "",
      /**
       * Append content-stream operators to the current page.
       * @param {string} fragment - Operators to append.
       * @returns {void}
       */
      write(fragment) {
        state.buffer += fragment;
      },
      /**
       * Finish the current page and start a fresh one.
       * @returns {void}
       */
      newPage() {
        pages.push(state.buffer);
        state.buffer = "";
        state.y = PAGE_HEIGHT - MARGIN;
      },
      /**
       * Start a new page when the requested vertical space is unavailable.
       * @param {number} needed - Required height in points.
       * @returns {void}
       */
      ensureRoom(needed) {
        if (state.y - needed < MARGIN) state.newPage();
      },
    };

    state.newPage();
    state.write(drawText("F2", TITLE_SIZE, MARGIN, state.y, document.title));
    state.y -= LINE_HEIGHT * 1.6;
    if (document.subtitle) {
      state.write(drawText("F1", HEADING_SIZE, MARGIN, state.y, document.subtitle));
      state.y -= LINE_HEIGHT * 1.6;
    }

    document.sections.forEach((section) => renderSection(section, state));
    pages.push(state.buffer);

    // A page break with nothing drawn after it leaves an empty buffer behind.
    return assemble(pages.filter((content) => content !== ""));
  }

  /**
   * Assemble page content streams into a complete PDF file with a valid
   * cross-reference table.
   * @param {string[]} pages - Per-page content streams.
   * @returns {Uint8Array} The PDF bytes.
   */
  function assemble(pages) {
    const objects = [];

    /**
     * Register one indirect object and return its object number.
     * @param {string} body - Object body.
     * @returns {number} The 1-based object number.
     */
    function addObject(body) {
      objects.push(body);
      return objects.length;
    }

    // Reserve 1 for the catalog and 2 for the page tree; both need forward
    // references to objects that do not exist yet.
    addObject("");
    addObject("");
    const regularFont = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
    const boldFont = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");

    const pageIds = [];
    pages.forEach((content) => {
      const streamId = addObject(
        `<< /Length ${content.length} >>\nstream\n${content}endstream`,
      );
      pageIds.push(
        addObject(
          "<< /Type /Page /Parent 2 0 R " +
            `/MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
            `/Resources << /Font << /F1 ${regularFont} 0 R /F2 ${boldFont} 0 R >> >> ` +
            `/Contents ${streamId} 0 R >>`,
        ),
      );
    });

    objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
    objects[1] =
      `<< /Type /Pages /Count ${pageIds.length} ` +
      `/Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`;

    let file = "%PDF-1.4\n";
    const offsets = [];
    objects.forEach((body, index) => {
      offsets.push(file.length);
      file += `${index + 1} 0 obj\n${body}\nendobj\n`;
    });

    const xrefOffset = file.length;
    file += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.forEach((offset) => {
      file += `${String(offset).padStart(10, "0")} 00000 n \n`;
    });
    file +=
      `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
      `startxref\n${xrefOffset}\n%%EOF\n`;

    const bytes = new Uint8Array(file.length);
    /* eslint-disable security/detect-object-injection -- Sequential write into
       a fixed-length typed array. */
    for (let index = 0; index < file.length; index += 1) {
      bytes[index] = file.charCodeAt(index) & 0xff;
    }
    /* eslint-enable security/detect-object-injection */
    return bytes;
  }

  globalThis.docuAlignPdf = Object.freeze({
    PAGE_HEIGHT,
    PAGE_WIDTH,
    clipText,
    createDocument,
    escapeText,
  });
})();
