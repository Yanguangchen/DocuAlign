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
      rows: [
        ["Client", "Acme"],
        ["Job", "JOB-42"],
      ],
    },
    {
      name: "Results",
      hidden: true,
      rows: [
        ["Test", "Value"],
        ["Moisture", 12.4],
      ],
    },
    {
      name: "Empty",
      hidden: false,
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
  });

  afterEach(() => {
    delete globalThis.docuAlignWorkbookPdf;
  });

  it("reads the uploaded bytes and parses every workbook tab in tab order", async () => {
    const file = workbookFile();
    const xlsx = xlsxAdapter();
    const { parseWorkbook } = await loadModule();

    const parsed = await parseWorkbook(file, xlsx);

    expect(file.arrayBuffer).toHaveBeenCalledOnce();
    expect(xlsx.read).toHaveBeenCalledWith(expect.any(ArrayBuffer), {
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
    const { parseWorkbook, validateWorkbook } = await loadModule();

    expect(validateWorkbook(parsedFixture)).toEqual({ isValid: true, sheetCount: 3 });
    expect(validateWorkbook({ sheets: [] })).toEqual({ isValid: false, sheetCount: 0 });
    await expect(parseWorkbook({}, xlsxAdapter())).rejects.toThrow("could not be read");
    await expect(parseWorkbook(workbookFile(), null)).rejects.toThrow("parser is unavailable");

    const noSheets = xlsxAdapter();
    noSheets.read.mockReturnValue({ SheetNames: [], Sheets: {} });
    await expect(parseWorkbook(workbookFile(), noSheets)).rejects.toThrow("does not contain any worksheets");
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
  });
});
