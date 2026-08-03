/**
 * @file summary-pdf.test.js
 * @description Locks the Summary worksheet to the approved one-page reference
 * PDF while proving that workbook metadata, limits, and result rows are mapped
 * from the uploaded Excel file rather than copied from the sample PDF.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as PDFLib from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const templateBytes = readFileSync(resolve("SampleDocuments/sample_summary.pdf"));
const workbookBytes = readFileSync(resolve("SampleDocuments/SampleInput.xlsx"));

async function sampleSummaryCells() {
  await import("./xlsx-reader.js");
  const workbook = await globalThis.docuAlignXlsx.readWorkbook({
    arrayBuffer: async () =>
      workbookBytes.buffer.slice(
        workbookBytes.byteOffset,
        workbookBytes.byteOffset + workbookBytes.byteLength,
      ),
  });
  return workbook.sheets.get("Summary");
}

describe("Summary sample-template PDF renderer", () => {
  beforeEach(() => {
    vi.resetModules();
    delete globalThis.docuAlignSummaryPdf;
    delete globalThis.docuAlignSummaryTemplateBase64;
    delete globalThis.docuAlignXlsx;
    globalThis.docuAlignLogger = { logInfo: vi.fn() };
  });

  afterEach(() => {
    delete globalThis.docuAlignSummaryPdf;
    delete globalThis.docuAlignSummaryTemplateBase64;
    delete globalThis.docuAlignXlsx;
    delete globalThis.docuAlignLogger;
    vi.unstubAllGlobals();
  });

  it("maps the sample workbook metadata, limits, and six result rows", async () => {
    const cells = await sampleSummaryCells();
    await import("./summary-pdf.js");

    const plan = globalThis.docuAlignSummaryPdf.buildOverlayPlan(cells);

    expect(plan.metadata).toEqual({
      clientName: "Xinsha Holding Pte Ltd",
      addressLine1: "9 Temasek Boulevard #22-03 Suntec Tower 2",
      addressLine2: "Singapore 038989",
      projectTitle: "Reclamation Sand Testing",
      jobReference: "X-2026-522",
      vesselName: "JIAHE 99",
      voyageNumber: "JH99-96N",
    });
    expect(plan.sieveSizes).toEqual(["0.06", "0.20", "0.60", "0.85", "1.18", "2.00", "3.00"]);
    expect(plan.chemicalHeaders).toEqual([
      "As",
      "Ba",
      "Cd",
      "Co",
      "Cr",
      "Cu",
      "Pb",
      "Hg",
      "Mo",
      "Ni",
      "Se",
      "Zn",
    ]);
    expect(plan.limits).toEqual([
      "0-10",
      "0-15",
      "10-50",
      "15-75",
      "30-85",
      "60-100",
      "85-100",
      "< 15%",
      "32o - 45o",
      "-",
      "30",
      "200",
      "2",
      "20",
      "100",
      "35",
      "100",
      "0.5",
      "10",
      "35",
      "20",
      "200",
      "-",
    ]);
    expect(plan.rows).toHaveLength(6);
    expect(plan.rows[0]).toEqual([
      "08/04/2026",
      "2-C",
      "PASS",
      "1",
      "5",
      "24",
      "37",
      "56",
      "82",
      "94",
      "1.7",
      "38",
      "9.6",
      "<1",
      "2.0",
      "<1",
      "<1",
      "1.0",
      "<1",
      "1.5",
      "<0.3",
      "<1",
      "1.3",
      "<1",
      "5.2",
      "0.12",
    ]);
    expect(plan.rows.at(-1)).toEqual([
      "08/04/2026",
      "5-B",
      "PASS",
      "1",
      "5",
      "26",
      "36",
      "57",
      "83",
      "95",
      "1.5",
      "38",
      "9.9",
      "N/A",
      "N/A",
      "N/A",
      "N/A",
      "N/A",
      "N/A",
      "N/A",
      "N/A",
      "N/A",
      "N/A",
      "N/A",
      "N/A",
      "0.10",
    ]);
  });

  it("recovers Summary cells from documents saved before the fixed renderer existed", async () => {
    const cells = await sampleSummaryCells();
    const legacyGrid = globalThis.docuAlignXlsx.toGrid(cells);
    await import("./summary-pdf.js");

    const recovered = globalThis.docuAlignSummaryPdf.cellsFromDocumentData([
      { heading: "Summary", columns: legacyGrid.columns, rows: legacyGrid.rows },
    ]);
    const plan = globalThis.docuAlignSummaryPdf.buildOverlayPlan(recovered);

    expect(plan.metadata).toMatchObject({
      clientName: "Xinsha Holding Pte Ltd",
      jobReference: "X-2026-522",
      vesselName: "JIAHE 99",
      voyageNumber: "JH99-96N",
    });
    expect(plan.sieveSizes).toEqual(["0.06", "0.20", "0.60", "0.85", "1.18", "2.00", "3.00"]);
    expect(plan.rows).toHaveLength(6);
    expect(plan.rows.at(-1).slice(0, 3)).toEqual(["08/04/2026", "5-B", "PASS"]);
  });

  it("accepts current payloads and safely rejects malformed legacy data", async () => {
    await import("./summary-pdf.js");
    const { cellsFromDocumentData } = globalThis.docuAlignSummaryPdf;

    expect(cellsFromDocumentData({
      renderer: "summary",
      cells: [["F9", "Live client"]],
    })).toEqual(new Map([["F9", "Live client"]]));
    expect(cellsFromDocumentData([
      { heading: "Other", columns: ["A"], rows: [["not a Summary anchor"], null] },
    ])).toEqual(new Map());
    expect(cellsFromDocumentData([null])).toEqual(new Map());
    expect(() => cellsFromDocumentData({ renderer: "summary" })).toThrow(
      "Summary document data is not a supported payload.",
    );
  });

  it("preserves the exact one-page template geometry and overlays live values", async () => {
    const cells = await sampleSummaryCells();
    await import("./summary-pdf.js");

    const bytes = await globalThis.docuAlignSummaryPdf.createDocument(cells, {
      pdfLib: PDFLib,
      templateBytes,
    });
    const output = await PDFLib.PDFDocument.load(bytes);
    const template = await PDFLib.PDFDocument.load(templateBytes);

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(output.getPageCount()).toBe(1);
    expect(output.getPage(0).getSize()).toEqual(template.getPage(0).getSize());
    expect(globalThis.docuAlignLogger.logInfo).toHaveBeenCalledWith(
      "Summary PDF template rendering completed",
      expect.objectContaining({
        rowCount: 6,
        pageCount: 1,
        templateSource: "injected",
      }),
    );
  });

  it("rules the result body at the reference page's own weight", async () => {
    const cells = await sampleSummaryCells();
    await import("./summary-pdf.js");
    const renderer = globalThis.docuAlignSummaryPdf;

    // Record what the renderer paints, so rule weight and placement can be
    // asserted directly rather than inferred from the finished PDF.
    const drawn = [];
    const page = {
      drawRectangle: (options) => drawn.push(options),
      drawText: () => {},
      drawLine: () => {
        throw new Error("Rules must be filled rectangles, as the reference draws them.");
      },
    };
    const recordingPdfLib = {
      PDFDocument: {
        load: async () => ({
          getPageCount: () => 1,
          getPage: () => page,
          embedFont: async () => ({ widthOfTextAtSize: (text) => text.length * 4 }),
          save: async () => new Uint8Array([37, 80, 68, 70]),
        }),
      },
      StandardFonts: { Helvetica: "Helvetica", HelveticaBold: "Helvetica-Bold" },
      rgb: (red, green, blue) => `rgb(${red},${green},${blue})`,
    };

    await renderer.createDocument(cells, { pdfLib: recordingPdfLib, templateBytes });

    // The sample workbook holds six result rows, so the body is closed by
    // seven horizontal rules, each at the reference's 0.84pt weight.
    const black = drawn.filter((shape) => shape.color === "rgb(0,0,0)");
    const horizontal = black.filter((shape) => shape.height === renderer.RULE_THICKNESS);
    const vertical = black.filter((shape) => shape.width === renderer.RULE_THICKNESS);
    expect(horizontal).toHaveLength(7);
    expect(vertical).toHaveLength(renderer.TABLE_RULE_X.length);
    expect(vertical.map((shape) => shape.x)).toEqual([...renderer.TABLE_RULE_X]);
    horizontal.forEach((shape, index) =>
      expect(shape.y).toBeCloseTo(renderer.BODY_TOP_RULE - index * renderer.BODY_ROW_HEIGHT, 5));

    // The body mask must clear the reference's own top rule completely; any of
    // it left behind sits under the redrawn rule and thickens it.
    const bodyMask = drawn
      .filter((shape) => shape.color === "rgb(1,1,1)")
      .find((shape) => shape.y < renderer.BODY_TOP_RULE && shape.width > 700);
    expect(bodyMask.y + bodyMask.height).toBeGreaterThanOrEqual(
      renderer.BODY_TOP_RULE + renderer.RULE_THICKNESS,
    );
  });

  it("never masks over the vertical rules when replacing header values", async () => {
    const cells = await sampleSummaryCells();
    await import("./summary-pdf.js");
    const renderer = globalThis.docuAlignSummaryPdf;

    const drawn = [];
    const page = {
      drawRectangle: (options) => drawn.push(options),
      drawText: () => {},
    };
    const recordingPdfLib = {
      PDFDocument: {
        load: async () => ({
          getPageCount: () => 1,
          getPage: () => page,
          embedFont: async () => ({ widthOfTextAtSize: (text) => text.length * 4 }),
          save: async () => new Uint8Array([37, 80, 68, 70]),
        }),
      },
      StandardFonts: { Helvetica: "Helvetica", HelveticaBold: "Helvetica-Bold" },
      rgb: (red, green, blue) => `rgb(${red},${green},${blue})`,
    };

    await renderer.createDocument(cells, { pdfLib: recordingPdfLib, templateBytes });

    // The two header rows are masked cell by cell and their rules are never
    // redrawn, so a mask that overlaps one erases it for good.
    const headerMasks = drawn.filter((shape) =>
      shape.color === "rgb(1,1,1)" && shape.y >= 352 && shape.y < 377 && shape.width < 100);
    expect(headerMasks.length).toBeGreaterThan(20);

    const overlaps = [];
    headerMasks.forEach((mask) => {
      renderer.TABLE_RULE_X.forEach((x) => {
        const ruleRight = x + renderer.RULE_THICKNESS;
        if (mask.x < ruleRight && mask.x + mask.width > x) overlaps.push({ mask: mask.x, rule: x });
      });
    });
    expect(overlaps).toEqual([]);
  });

  it("renders every result row a longer workbook holds", async () => {
    // The reference workbook stops at row 27; a file with more cargo holds
    // must not have its extra rows silently dropped.
    const cells = new Map([
      ["A18", "08/04/2026"],
      ["C18", "2-C"],
      ["A28", "09/04/2026"],
      ["C28", "6-A"],
      ["A31", "09/04/2026"],
      ["C31", "7-B"],
      // Blank cells and Excel's phantom out-of-table references must not
      // stretch the table past its real last row.
      ["C44", "   "],
      ["C50", null],
      ["XEM60", "Date received"],
    ]);
    await import("./summary-pdf.js");
    const plan = globalThis.docuAlignSummaryPdf.buildOverlayPlan(cells);

    expect(plan.rows).toHaveLength(3);
    expect(plan.rows.map((row) => row[1])).toEqual(["2-C", "6-A", "7-B"]);
  });

  it("removes blank result rows and supports a direct-file embedded template", async () => {
    const cells = await sampleSummaryCells();
    cells.delete("A23");
    for (const column of "CDEFGHIJKLMNOPQRSTUVWXYZ".split("")) cells.delete(`${column}23`);
    cells.delete("AA23");
    globalThis.docuAlignSummaryTemplateBase64 = templateBytes.toString("base64");
    globalThis.PDFLib = PDFLib;
    await import("./summary-pdf.js");

    const plan = globalThis.docuAlignSummaryPdf.buildOverlayPlan(cells);
    const bytes = await globalThis.docuAlignSummaryPdf.createDocument(cells);

    expect(plan.rows).toHaveLength(5);
    expect((await PDFLib.PDFDocument.load(bytes)).getPageCount()).toBe(1);
    expect(globalThis.docuAlignLogger.logInfo).toHaveBeenCalledWith(
      "Summary PDF template rendering completed",
      expect.objectContaining({ templateSource: "embedded" }),
    );
  });

  it("loads the bundled template over HTTP and reports asset failures", async () => {
    await import("./summary-pdf.js");
    const successFetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => templateBytes,
    });

    const bytes = await globalThis.docuAlignSummaryPdf.createDocument(new Map(), {
      pdfLib: PDFLib,
      fetchImpl: successFetch,
    });
    expect((await PDFLib.PDFDocument.load(bytes)).getPageCount()).toBe(1);
    expect(successFetch).toHaveBeenCalledWith(
      expect.stringContaining("SampleDocuments/sample_summary.pdf"),
    );
    expect(globalThis.docuAlignLogger.logInfo).toHaveBeenCalledWith(
      "Summary PDF template rendering completed",
      expect.objectContaining({ templateSource: "bundled", rowCount: 0 }),
    );

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(globalThis.docuAlignSummaryPdf.createDocument(new Map(), {
      pdfLib: PDFLib,
    })).rejects.toThrow("Could not load the Summary PDF template (404)");
  });

  it("rejects missing cells, libraries, and invalid templates", async () => {
    await import("./summary-pdf.js");
    const onePage = await PDFLib.PDFDocument.create();
    onePage.addPage();
    onePage.addPage();

    await expect(globalThis.docuAlignSummaryPdf.createDocument(null, {
      pdfLib: PDFLib,
      templateBytes,
    })).rejects.toThrow("Summary worksheet cells");
    await expect(globalThis.docuAlignSummaryPdf.createDocument(new Map(), {
      pdfLib: null,
      templateBytes,
    })).rejects.toThrow("PDF template library");
    await expect(globalThis.docuAlignSummaryPdf.createDocument(new Map(), {
      pdfLib: PDFLib,
      templateBytes: await onePage.save(),
    })).rejects.toThrow("exactly one page");
  });
});
