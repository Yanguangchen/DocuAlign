/**
 * @file rak-report-pdf.test.js
 * @description Rendering coverage for the fixed five-page RAK report template
 * and multi-report workbook export.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { autoTable } from "jspdf-autotable";
import { jsPDF } from "jspdf";
import * as XLSX from "xlsx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function pdfAdapter() {
  const blob = new Blob(["%PDF-semantic"], { type: "application/pdf" });
  const documents = [];
  const table = vi.fn();

  class FakePdf {
    constructor(options) {
      this.options = options;
      this.pages = 1;
      this.textCalls = [];
      this.imageCalls = [];
      documents.push(this);
    }

    addPage() { this.pages += 1; }

    addImage(...args) { this.imageCalls.push(args); }

    circle() {}

    line() {}

    rect() {}

    setDrawColor() {}

    setFillColor() {}

    setFont() {}

    setFontSize() {}

    setLineWidth() {}

    setTextColor() {}

    text(value, x, y) { this.textCalls.push({ value, x, y }); }

    output(type) {
      expect(type).toBe("blob");
      return blob;
    }
  }

  return {
    api: { jsPDF: FakePdf, autoTable: table },
    blob,
    documents,
    table,
  };
}

async function sampleReports() {
  const bytes = readFileSync(resolve("SampleDocuments/SampleInput.xlsx"));
  await import("./workbook-pdf.js");
  await import("./report-mapping.js");
  await import("./rak-report-pdf.js");
  const parsed = await globalThis.docuAlignWorkbookPdf.parseWorkbook(
    {
      name: "SampleInput.xlsx",
      arrayBuffer: async () =>
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    },
    XLSX,
  );
  return globalThis.docuAlignReportMapping.buildMappedReports(parsed);
}

describe("RAK semantic report PDF renderer", () => {
  beforeEach(() => {
    vi.resetModules();
    delete globalThis.docuAlignWorkbookPdf;
    delete globalThis.docuAlignReportMapping;
    delete globalThis.docuAlignRakReportPdf;
  });

  afterEach(() => {
    delete globalThis.docuAlignWorkbookPdf;
    delete globalThis.docuAlignReportMapping;
    delete globalThis.docuAlignRakReportPdf;
  });

  it("renders each mapped report as the five sample-layout pages", async () => {
    const reports = await sampleReports();
    const sample = reports.find((report) => report.groupIndex === 2);
    const pdf = pdfAdapter();

    const result = globalThis.docuAlignRakReportPdf.createRakReportPdf([sample], pdf.api);

    expect(result).toBe(pdf.blob);
    expect(pdf.documents[0].options).toMatchObject({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
    });
    expect(pdf.documents[0].pages).toBe(5);
    const renderedText = pdf.documents[0].textCalls
      .flatMap((call) => Array.isArray(call.value) ? call.value : [call.value])
      .join("\n");
    expect(renderedText).toContain("TEST REPORT");
    expect(renderedText).toContain("JOB REF: X-2026-522-2");
    expect(renderedText).toContain("Determination of Particle Size Distribution");
    expect(renderedText).toContain("Shear Strength by Direct Shear");
    expect(renderedText).toContain("12 Metallic Analysis");
    expect(renderedText).toContain("Jocelyn Lee Jia Min");
    expect(renderedText).toContain("APPENDIX");
    expect(pdf.table).toHaveBeenCalledTimes(3);
    expect(pdf.documents[0].imageCalls.length).toBeGreaterThanOrEqual(4);
  });

  it("combines all six workbook reports into one 30-page export", async () => {
    const reports = await sampleReports();
    const pdf = pdfAdapter();

    globalThis.docuAlignRakReportPdf.createRakReportPdf(reports, pdf.api);

    expect(pdf.documents[0].pages).toBe(30);
    expect(pdf.documents[0].textCalls.some((call) =>
      String(call.value).includes("X-2026-522-6"))).toBe(true);
  });

  it("produces a real five-page PDF for the reference sample", async () => {
    const reports = await sampleReports();
    const sample = reports.find((report) => report.groupIndex === 2);

    const blob = globalThis.docuAlignRakReportPdf.createRakReportPdf(
      [sample],
      { jsPDF, autoTable },
    );
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const rawPdf = new TextDecoder("latin1").decode(bytes);

    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(rawPdf.match(/\/Type\s*\/Page\b/g) ?? []).toHaveLength(5);
  });

  it("rejects missing report data or unavailable PDF libraries", async () => {
    const reports = await sampleReports();
    const sample = reports[0];

    expect(() => globalThis.docuAlignRakReportPdf.createRakReportPdf([])).toThrow(
      "at least one mapped report",
    );
    expect(() => globalThis.docuAlignRakReportPdf.createRakReportPdf([sample], null)).toThrow(
      "PDF generator is unavailable",
    );
    expect(() => globalThis.docuAlignRakReportPdf.createRakReportPdf(
      [sample],
      { jsPDF: pdfAdapter().api.jsPDF },
    )).toThrow("PDF table renderer is unavailable");
  });
});
