/**
 * @file workbook-pdf.js
 * @description Browser-side Excel ingestion and deterministic PDF rendering.
 * The module is intentionally classic-script compatible so uploaded workbooks
 * can still be processed when the workspace is opened directly over file://.
 */
(() => {
  const PDF_OPTIONS = Object.freeze({
    orientation: "landscape",
    unit: "mm",
    format: "a4",
    compress: true,
  });

  /**
   * Remove rows with no displayable values while preserving populated values
   * and their worksheet order.
   * @param {unknown} rows - SheetJS array-of-arrays output.
   * @returns {Array<Array<unknown>>} Populated worksheet rows.
   */
  function populatedRows(rows) {
    if (!Array.isArray(rows)) return [];

    return rows
      .map((row) => {
        if (!Array.isArray(row)) return [row ?? ""];
        return row.map((cell) => cell ?? "");
      })
      .filter((row) => row.some((cell) => String(cell).trim() !== ""));
  }

  /**
   * Validate the workbook representation consumed by PDF generation.
   * @param {object} workbookData - Parsed workbook data.
   * @returns {{isValid: boolean, sheetCount: number}} Validation result.
   */
  function validateWorkbook(workbookData = {}) {
    const sheetCount = Array.isArray(workbookData.sheets) ? workbookData.sheets.length : 0;
    return {
      isValid: sheetCount > 0,
      sheetCount,
    };
  }

  /**
   * Parse every worksheet in an uploaded XLS/XLSX file in workbook tab order.
   * @param {File|{name?: string, arrayBuffer: () => Promise<ArrayBuffer>}} file
   * @param {object} [xlsxApi=globalThis.XLSX] - SheetJS browser API.
   * @returns {Promise<{sourceName: string, sheets: Array<object>}>}
   */
  async function parseWorkbook(file, xlsxApi = globalThis.XLSX) {
    if (!file || typeof file.arrayBuffer !== "function") {
      throw new TypeError("The selected workbook could not be read.");
    }
    if (
      !xlsxApi
      || typeof xlsxApi.read !== "function"
      || typeof xlsxApi.utils?.sheet_to_json !== "function"
    ) {
      throw new Error("The Excel workbook parser is unavailable.");
    }

    const workbookBytes = await file.arrayBuffer();
    const workbook = xlsxApi.read(workbookBytes, {
      cellDates: true,
      cellStyles: true,
    });
    const sheetNames = Array.isArray(workbook.SheetNames) ? workbook.SheetNames : [];

    if (sheetNames.length === 0) {
      throw new Error("The workbook does not contain any worksheets.");
    }

    const sheetMetadata = Array.isArray(workbook.Workbook?.Sheets)
      ? workbook.Workbook.Sheets
      : [];
    const sheets = sheetNames.map((name, index) => {
      const worksheet = Reflect.get(workbook.Sheets ?? {}, name);
      const metadata = sheetMetadata.at(index);
      const rows = xlsxApi.utils.sheet_to_json(worksheet, {
        header: 1,
        defval: "",
        raw: false,
        blankrows: true,
      });

      return {
        name,
        hidden: Number(metadata?.Hidden ?? 0) > 0,
        rows: populatedRows(rows),
      };
    });

    return {
      sourceName: file.name ?? "workbook",
      sheets,
    };
  }

  function resolvePdfConstructor(pdfApi) {
    if (pdfApi === null) return null;
    return pdfApi?.jsPDF ?? globalThis.jspdf?.jsPDF ?? null;
  }

  function resolveAutoTable(pdfApi, pdfDocument) {
    if (typeof pdfApi?.autoTable === "function") return pdfApi.autoTable;
    if (typeof globalThis.jspdfAutoTable?.autoTable === "function") {
      return globalThis.jspdfAutoTable.autoTable;
    }
    if (typeof globalThis.autoTable === "function") return globalThis.autoTable;
    if (typeof pdfDocument.autoTable === "function") {
      return (document, options) => document.autoTable(options);
    }
    return null;
  }

  function drawSheetHeading(pdfDocument, sheet) {
    pdfDocument.setFont("helvetica", "bold");
    pdfDocument.setFontSize(15);
    pdfDocument.setTextColor(22, 67, 82);
    const title = sheet.hidden ? `${sheet.name} (hidden worksheet)` : sheet.name;
    pdfDocument.text(title, 10, 11);
  }

  /**
   * Render every parsed worksheet to a generated PDF Blob. Each workbook tab
   * starts on a new page; wide and long tables are paginated by AutoTable.
   * @param {{sheets: Array<object>}} workbookData - Parsed workbook data.
   * @param {{jsPDF?: Function, autoTable?: Function}} [pdfApi] - Injectable PDF APIs.
   * @returns {Blob} Generated workbook PDF.
   */
  function createWorkbookPdf(workbookData, pdfApi) {
    const validation = validateWorkbook(workbookData);
    if (!validation.isValid) {
      throw new Error("The parsed workbook does not contain any worksheets.");
    }

    const PdfConstructor = resolvePdfConstructor(pdfApi);
    if (typeof PdfConstructor !== "function") {
      throw new Error("The browser PDF generator is unavailable.");
    }

    const pdfDocument = new PdfConstructor(PDF_OPTIONS);
    const autoTable = resolveAutoTable(pdfApi, pdfDocument);
    if (typeof autoTable !== "function") {
      throw new Error("The PDF table renderer is unavailable.");
    }

    workbookData.sheets.forEach((sheet, index) => {
      if (index > 0) pdfDocument.addPage();
      drawSheetHeading(pdfDocument, sheet);

      if (sheet.rows.length === 0) {
        pdfDocument.setFont("helvetica", "normal");
        pdfDocument.setFontSize(10);
        pdfDocument.setTextColor(80, 96, 104);
        pdfDocument.text("This worksheet has no populated cells.", 10, 20);
        return;
      }

      autoTable(pdfDocument, {
        body: sheet.rows,
        startY: 16,
        margin: { top: 16, right: 8, bottom: 10, left: 8 },
        theme: "grid",
        showHead: "never",
        rowPageBreak: "avoid",
        horizontalPageBreak: true,
        horizontalPageBreakBehaviour: "immediately",
        styles: {
          font: "helvetica",
          fontSize: 7,
          cellPadding: 1.2,
          overflow: "linebreak",
          valign: "top",
          textColor: [30, 48, 55],
          lineColor: [196, 211, 216],
          lineWidth: 0.1,
        },
        alternateRowStyles: {
          fillColor: [244, 248, 249],
        },
      });
    });

    return pdfDocument.output("blob");
  }

  globalThis.docuAlignWorkbookPdf = Object.freeze({
    createWorkbookPdf,
    parseWorkbook,
    populatedRows,
    validateWorkbook,
  });
})();
