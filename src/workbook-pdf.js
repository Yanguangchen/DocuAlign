/**
 * @file workbook-pdf.js
 * @description Browser-side Excel ingestion and deterministic PDF rendering.
 * The module is intentionally classic-script compatible so uploaded workbooks
 * can still be processed when the workspace is opened directly over file://.
 */
(() => {
  const OFFICE_RELATIONSHIPS =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
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

  function normalizeZipPath(baseFile, target) {
    if (target.startsWith("/")) return target.slice(1);
    const segments = baseFile.split("/");
    segments.pop();
    for (const part of target.split("/")) {
      if (part === "..") {
        segments.pop();
      } else if (part !== "." && part !== "") {
        segments.push(part);
      }
    }
    return segments.join("/");
  }

  function relationshipPath(filePath) {
    const segments = filePath.split("/");
    const fileName = segments.pop();
    return [...segments, "_rels", `${fileName}.rels`].join("/");
  }

  function fileContent(files, filePath) {
    const entry = Reflect.get(files, filePath);
    if (!entry?.content) return null;
    if (typeof entry.content === "string") return entry.content;
    return new TextDecoder().decode(entry.content);
  }

  function parseXml(files, filePath) {
    const content = fileContent(files, filePath);
    if (!content) return null;
    return new DOMParser().parseFromString(content, "application/xml");
  }

  function elementsByLocalName(parent, localName) {
    return Array.from(parent.getElementsByTagName("*"))
      .filter((element) => element.localName === localName);
  }

  function firstByLocalName(parent, localName) {
    return elementsByLocalName(parent, localName).at(0) ?? null;
  }

  function relationshipAttribute(element, localName, qualifiedName) {
    return element?.getAttributeNS(OFFICE_RELATIONSHIPS, localName)
      ?? element?.getAttribute(qualifiedName)
      ?? null;
  }

  function relationshipMap(document, baseFile) {
    const relationships = new Map();
    if (!document) return relationships;
    for (const relationship of elementsByLocalName(document, "Relationship")) {
      const id = relationship.getAttribute("Id");
      const target = relationship.getAttribute("Target");
      if (id && target) relationships.set(id, {
        path: normalizeZipPath(baseFile, target),
        type: relationship.getAttribute("Type") ?? "",
      });
    }
    return relationships;
  }

  function mediaType(filePath) {
    const extension = filePath.split(".").at(-1)?.toLowerCase();
    if (extension === "png") return "image/png";
    if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
    return null;
  }

  function mediaBytes(files, filePath) {
    const content = Reflect.get(files, filePath)?.content;
    if (content instanceof Uint8Array) return content;
    if (content instanceof ArrayBuffer) return new Uint8Array(content);
    return null;
  }

  function anchoredImages(files, drawingPath) {
    const drawing = parseXml(files, drawingPath);
    const drawingRelationships = relationshipMap(
      parseXml(files, relationshipPath(drawingPath)),
      drawingPath,
    );
    if (!drawing) return [];

    const images = [];
    for (const anchor of drawing.documentElement.children) {
      const blip = firstByLocalName(anchor, "blip");
      const relationshipId = relationshipAttribute(blip, "embed", "r:embed");
      const mediaPath = drawingRelationships.get(relationshipId)?.path;
      const mimeType = mediaPath ? mediaType(mediaPath) : null;
      const bytes = mediaPath ? mediaBytes(files, mediaPath) : null;
      if (!mimeType || !bytes) continue;

      const from = firstByLocalName(anchor, "from");
      const row = from
        ? Number(firstByLocalName(from, "row")?.textContent)
        : -1;
      const column = from
        ? Number(firstByLocalName(from, "col")?.textContent)
        : -1;
      const properties = firstByLocalName(anchor, "cNvPr");
      images.push({
        name: properties?.getAttribute("name") ?? "Workbook image",
        row,
        column,
        mimeType,
        bytes,
      });
    }
    return images;
  }

  /**
   * Associate embedded workbook pictures with their worksheet and anchor cell.
   * @param {object} workbook - SheetJS workbook parsed with `bookFiles: true`.
   * @returns {Map<string, Array<object>>} Images keyed by worksheet name.
   */
  function extractWorkbookImages(workbook) {
    const files = workbook.files;
    if (!files) return new Map();
    const workbookPath = "xl/workbook.xml";
    const workbookXml = parseXml(files, workbookPath);
    const workbookRelationships = relationshipMap(
      parseXml(files, relationshipPath(workbookPath)),
      workbookPath,
    );
    if (!workbookXml) return new Map();

    const imagesBySheet = new Map();
    for (const sheet of elementsByLocalName(workbookXml, "sheet")) {
      const sheetName = sheet.getAttribute("name");
      const relationshipId = relationshipAttribute(sheet, "id", "r:id");
      const worksheetPath = workbookRelationships.get(relationshipId)?.path;
      if (!sheetName || !worksheetPath) continue;

      const worksheetRelationships = relationshipMap(
        parseXml(files, relationshipPath(worksheetPath)),
        worksheetPath,
      );
      const drawing = Array.from(worksheetRelationships.values())
        .find((relationship) => relationship.type.endsWith("/drawing"));
      imagesBySheet.set(
        sheetName,
        drawing ? anchoredImages(files, drawing.path) : [],
      );
    }
    return imagesBySheet;
  }

  function displayCells(worksheet) {
    const cells = {};
    for (const [address, cell] of Object.entries(worksheet ?? {})) {
      if (!/^[A-Z]+\d+$/.test(address) || !cell || typeof cell !== "object") continue;
      Reflect.set(cells, address, cell.w ?? cell.v ?? "");
    }
    return cells;
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
      bookFiles: true,
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
    const imagesBySheet = extractWorkbookImages(workbook);
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
        cells: displayCells(worksheet),
        images: imagesBySheet.get(name) ?? [],
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
    displayCells,
    extractWorkbookImages,
    parseWorkbook,
    populatedRows,
    validateWorkbook,
  });
})();
