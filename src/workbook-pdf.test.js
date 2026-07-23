/**
 * @file workbook-pdf.test.js
 * @description Unit coverage for parsing every worksheet in an uploaded
 * workbook and rendering those parsed sheets into a generated PDF Blob.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as XLSX from "xlsx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const parsedFixture = {
  sourceName: "all-tabs.xlsx",
  sheets: [
    {
      name: "Cover",
      hidden: false,
      cells: {},
      images: [],
      rows: [
        ["Client", "Acme"],
        ["Job", "JOB-42"],
      ],
    },
    {
      name: "Results",
      hidden: true,
      cells: {},
      images: [],
      rows: [
        ["Test", "Value"],
        ["Moisture", 12.4],
      ],
    },
    {
      name: "Empty",
      hidden: false,
      cells: {},
      images: [],
      rows: [],
    },
  ],
};

function workbookFile() {
  return {
    name: "all-tabs.xlsx",
    arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer),
  };
}

function xlsxAdapter() {
  const worksheets = {
    Cover: { rows: parsedFixture.sheets[0].rows },
    Results: { rows: parsedFixture.sheets[1].rows },
    Empty: { rows: [[], ["", null]] },
  };

  return {
    read: vi.fn(() => ({
      SheetNames: ["Cover", "Results", "Empty"],
      Sheets: worksheets,
      Workbook: {
        Sheets: [{ Hidden: 0 }, { Hidden: 1 }, { Hidden: 0 }],
      },
    })),
    utils: {
      sheet_to_json: vi.fn((worksheet) => worksheet.rows),
    },
  };
}

function pdfAdapter() {
  const blob = new Blob(["%PDF-generated"], { type: "application/pdf" });
  const documents = [];
  const autoTable = vi.fn();

  class FakePdf {
    constructor(options) {
      this.options = options;
      this.pages = 1;
      this.textCalls = [];
      documents.push(this);
    }

    addPage() {
      this.pages += 1;
    }

    setFont() {}

    setFontSize() {}

    setTextColor() {}

    text(value, x, y) {
      this.textCalls.push({ value, x, y });
    }

    output(type) {
      expect(type).toBe("blob");
      return blob;
    }
  }

  return {
    api: { jsPDF: FakePdf, autoTable },
    autoTable,
    blob,
    documents,
  };
}

async function loadModule() {
  await import("./workbook-pdf.js");
  return globalThis.docuAlignWorkbookPdf;
}

describe("workbook PDF pipeline", () => {
  beforeEach(() => {
    vi.resetModules();
    delete globalThis.docuAlignWorkbookPdf;
    delete globalThis.XLSX;
    delete globalThis.jspdf;
    delete globalThis.jspdfAutoTable;
    delete globalThis.autoTable;
  });

  afterEach(() => {
    delete globalThis.docuAlignWorkbookPdf;
    delete globalThis.XLSX;
    delete globalThis.jspdf;
    delete globalThis.jspdfAutoTable;
    delete globalThis.autoTable;
  });

  it("reads the uploaded bytes and parses every workbook tab in tab order", async () => {
    const file = workbookFile();
    const xlsx = xlsxAdapter();
    const { parseWorkbook } = await loadModule();

    const parsed = await parseWorkbook(file, xlsx);

    expect(file.arrayBuffer).toHaveBeenCalledOnce();
    expect(xlsx.read).toHaveBeenCalledWith(expect.any(ArrayBuffer), {
      bookFiles: true,
      cellDates: true,
      cellStyles: true,
    });
    expect(xlsx.utils.sheet_to_json).toHaveBeenCalledTimes(3);
    expect(parsed).toEqual(parsedFixture);
    expect(parsed.sheets.map((sheet) => sheet.name)).toEqual(["Cover", "Results", "Empty"]);
  });

  it("parses all 26 tabs from the real reference workbook", async () => {
    const bytes = readFileSync(resolve("SampleDocuments/SampleInput.xlsx"));
    const file = {
      name: "SampleInput.xlsx",
      arrayBuffer: async () =>
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    };
    const { parseWorkbook } = await loadModule();

    const parsed = await parseWorkbook(file, XLSX);

    expect(parsed.sheets).toHaveLength(26);
    expect(parsed.sheets.map((sheet) => sheet.name)).toEqual([
      "Summary",
      "coral + org",
      "CV1",
      "TR1",
      "DS1 ",
      "SB1 ",
      "CV1 (2)",
      "TR1 (2)",
      "DS1  (2)",
      "SB1  (2)",
      "CV1 (3)",
      "TR1 (3)",
      "DS1  (3)",
      "SB1  (3)",
      "CV1 (4)",
      "TR1 (4)",
      "DS1  (4)",
      "SB1  (4)",
      "CV1 (5)",
      "TR1 (5)",
      "DS1  (5)",
      "SB1  (5)",
      "CV1 (6)",
      "TR1 (6)",
      "DS1  (6)",
      "SB1  (6)",
    ]);
    expect(parsed.sheets.every((sheet) => sheet.rows.length > 0)).toBe(true);
  });

  it("validates parsed workbooks and rejects unreadable or sheetless inputs", async () => {
    const { parseWorkbook, populatedRows, validateWorkbook } = await loadModule();

    expect(validateWorkbook(parsedFixture)).toEqual({ isValid: true, sheetCount: 3 });
    expect(validateWorkbook({ sheets: [] })).toEqual({ isValid: false, sheetCount: 0 });
    expect(validateWorkbook({})).toEqual({ isValid: false, sheetCount: 0 });
    expect(populatedRows(null)).toEqual([]);
    expect(populatedRows(["Title", null, ["", null], ["Result", null]])).toEqual([
      ["Title"],
      ["Result", ""],
    ]);
    await expect(parseWorkbook({}, xlsxAdapter())).rejects.toThrow("could not be read");
    await expect(parseWorkbook(workbookFile(), null)).rejects.toThrow("parser is unavailable");

    const noSheets = xlsxAdapter();
    noSheets.read.mockReturnValue({ SheetNames: [], Sheets: {} });
    await expect(parseWorkbook(workbookFile(), noSheets)).rejects.toThrow("does not contain any worksheets");
    noSheets.read.mockReturnValue({ SheetNames: null });
    await expect(parseWorkbook(workbookFile(), noSheets)).rejects.toThrow("does not contain any worksheets");
  });

  it("uses browser globals and safe workbook metadata defaults", async () => {
    const sparseXlsx = {
      read: vi.fn(() => ({ SheetNames: ["Only tab"] })),
      utils: {
        sheet_to_json: vi.fn(() => [["Value"]]),
      },
    };
    globalThis.XLSX = sparseXlsx;
    const { parseWorkbook } = await loadModule();
    const file = {
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(1)),
    };

    const parsed = await parseWorkbook(file);

    expect(parsed).toEqual({
      sourceName: "workbook",
      sheets: [{
        name: "Only tab",
        hidden: false,
        cells: {},
        images: [],
        rows: [["Value"]],
      }],
    });
    expect(sparseXlsx.utils.sheet_to_json).toHaveBeenCalledWith(undefined, expect.any(Object));
  });

  it("renders every parsed tab into a new PDF instead of returning the sample asset", async () => {
    const { createWorkbookPdf } = await loadModule();
    const pdf = pdfAdapter();

    const result = createWorkbookPdf(parsedFixture, pdf.api);

    expect(result).toBe(pdf.blob);
    expect(pdf.documents).toHaveLength(1);
    expect(pdf.documents[0].options).toMatchObject({
      orientation: "landscape",
      unit: "mm",
      format: "a4",
    });
    expect(pdf.documents[0].pages).toBe(3);
    expect(pdf.documents[0].textCalls.map((call) => call.value)).toEqual([
      "Cover",
      "Results (hidden worksheet)",
      "Empty",
      "This worksheet has no populated cells.",
    ]);
    expect(pdf.autoTable).toHaveBeenCalledTimes(2);
    expect(pdf.autoTable.mock.calls[0][1]).toMatchObject({
      body: parsedFixture.sheets[0].rows,
      horizontalPageBreak: true,
      rowPageBreak: "avoid",
    });
    expect(pdf.autoTable.mock.calls[1][1].body).toEqual(parsedFixture.sheets[1].rows);
  });

  it("rejects PDF generation when data or browser PDF libraries are unavailable", async () => {
    const { createWorkbookPdf } = await loadModule();
    const adapter = pdfAdapter();

    expect(() => createWorkbookPdf({ sheets: [] }, adapter.api)).toThrow(
      "does not contain any worksheets",
    );
    expect(() => createWorkbookPdf(parsedFixture, null)).toThrow("PDF generator is unavailable");
    expect(() => createWorkbookPdf(parsedFixture, { jsPDF: adapter.api.jsPDF })).toThrow(
      "PDF table renderer is unavailable",
    );
    expect(() => createWorkbookPdf(parsedFixture)).toThrow("PDF generator is unavailable");
  });

  it("supports each browser PDF global exposed by the vendored UMD libraries", async () => {
    const { createWorkbookPdf } = await loadModule();

    const namespaced = pdfAdapter();
    globalThis.jspdf = { jsPDF: namespaced.api.jsPDF };
    globalThis.jspdfAutoTable = { autoTable: namespaced.autoTable };
    expect(createWorkbookPdf(parsedFixture)).toBe(namespaced.blob);
    expect(namespaced.autoTable).toHaveBeenCalled();

    delete globalThis.jspdfAutoTable;
    const directGlobal = pdfAdapter();
    globalThis.jspdf = { jsPDF: directGlobal.api.jsPDF };
    globalThis.autoTable = directGlobal.autoTable;
    expect(createWorkbookPdf(parsedFixture)).toBe(directGlobal.blob);
    expect(directGlobal.autoTable).toHaveBeenCalled();

    delete globalThis.autoTable;
    const documentPlugin = pdfAdapter();
    const autoTableMethod = vi.fn();
    documentPlugin.api.jsPDF.prototype.autoTable = autoTableMethod;
    globalThis.jspdf = { jsPDF: documentPlugin.api.jsPDF };
    expect(createWorkbookPdf(parsedFixture)).toBe(documentPlugin.blob);
    expect(autoTableMethod).toHaveBeenCalledWith(expect.objectContaining({
      horizontalPageBreak: true,
    }));
  });

  it("resolves workbook drawing relationships and ignores unsupported media", async () => {
    const { extractWorkbookImages } = await loadModule();
    const relationshipsNamespace =
      "http://schemas.openxmlformats.org/package/2006/relationships";
    const officeRelationships =
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    const drawingNamespace =
      "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing";
    const drawingMain = "http://schemas.openxmlformats.org/drawingml/2006/main";
    const files = {
      "xl/workbook.xml": {
        content: `<workbook xmlns:r="${officeRelationships}">
          <sheets>
            <sheet name="Images" r:id="rId1"/>
            <sheet name="Missing drawing" r:id="rId2"/>
            <sheet name="Orphan" r:id="missing"/>
            <sheet name="" r:id="rId1"/>
          </sheets>
        </workbook>`,
      },
      "xl/_rels/workbook.xml.rels": {
        content: `<Relationships xmlns="${relationshipsNamespace}">
          <Relationship Id="rId1" Type="${officeRelationships}/worksheet"
            Target="/xl/worksheets/sheet1.xml"/>
          <Relationship Id="rId2" Type="${officeRelationships}/worksheet"
            Target="./worksheets//sheet2.xml"/>
          <Relationship/>
        </Relationships>`,
      },
      "xl/worksheets/_rels/sheet1.xml.rels": {
        content: `<Relationships xmlns="${relationshipsNamespace}">
          <Relationship Id="drawing" Type="${officeRelationships}/drawing"
            Target="../drawings/drawing1.xml"/>
          <Relationship Id="no-type" Target="../drawings/ignored.xml"/>
        </Relationships>`,
      },
      "xl/worksheets/_rels/sheet2.xml.rels": {
        content: `<Relationships xmlns="${relationshipsNamespace}">
          <Relationship Id="drawing" Type="${officeRelationships}/drawing"
            Target="../drawings/missing.xml"/>
        </Relationships>`,
      },
      "xl/drawings/drawing1.xml": {
        content: `<xdr:wsDr xmlns:xdr="${drawingNamespace}"
          xmlns:a="${drawingMain}" xmlns:r="${officeRelationships}">
          <xdr:twoCellAnchor>
            <xdr:from><xdr:col>5</xdr:col><xdr:row>147</xdr:row></xdr:from>
            <xdr:pic>
              <xdr:nvPicPr><xdr:cNvPr name="JPEG photo"/></xdr:nvPicPr>
              <xdr:blipFill><a:blip r:embed="img1"/></xdr:blipFill>
            </xdr:pic>
          </xdr:twoCellAnchor>
          <xdr:twoCellAnchor>
            <xdr:pic><xdr:blipFill><a:blip r:embed="img2"/></xdr:blipFill></xdr:pic>
          </xdr:twoCellAnchor>
          <xdr:twoCellAnchor>
            <xdr:pic><xdr:blipFill><a:blip r:embed="gif"/></xdr:blipFill></xdr:pic>
          </xdr:twoCellAnchor>
          <xdr:twoCellAnchor>
            <xdr:pic><xdr:blipFill><a:blip r:embed="missing"/></xdr:blipFill></xdr:pic>
          </xdr:twoCellAnchor>
          <xdr:twoCellAnchor><xdr:pic><xdr:blipFill><a:blip/></xdr:blipFill></xdr:pic></xdr:twoCellAnchor>
        </xdr:wsDr>`,
      },
      "xl/drawings/_rels/drawing1.xml.rels": {
        content: `<Relationships xmlns="${relationshipsNamespace}">
          <Relationship Id="img1" Type="${officeRelationships}/image"
            Target="../media/photo.jpg"/>
          <Relationship Id="img2" Type="${officeRelationships}/image"
            Target="../media/photo.png"/>
          <Relationship Id="gif" Type="${officeRelationships}/image"
            Target="../media/photo.gif"/>
          <Relationship Id="missing" Type="${officeRelationships}/image"
            Target="../media/missing.png"/>
        </Relationships>`,
      },
      "xl/media/photo.jpg": { content: new ArrayBuffer(4) },
      "xl/media/photo.png": { content: new Uint8Array([1, 2, 3]) },
      "xl/media/photo.gif": { content: new Uint8Array([4, 5, 6]) },
    };

    const images = extractWorkbookImages({ files });

    expect(images.get("Images")).toEqual([
      expect.objectContaining({
        name: "JPEG photo",
        row: 147,
        column: 5,
        mimeType: "image/jpeg",
      }),
      expect.objectContaining({
        name: "Workbook image",
        row: -1,
        column: -1,
        mimeType: "image/png",
      }),
    ]);
    expect(images.get("Missing drawing")).toEqual([]);
    expect(images.has("Orphan")).toBe(false);
    expect(extractWorkbookImages({ files: {} })).toEqual(new Map());
    expect(extractWorkbookImages({})).toEqual(new Map());
  });
});
