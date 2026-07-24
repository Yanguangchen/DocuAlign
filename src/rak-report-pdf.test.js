/**
 * @file rak-report-pdf.test.js
 * @description Verifies that generated reports reuse the exact five-page
 * SampleOutput.pdf geometry and apply mapped values through template overlays.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as PDFLib from "pdf-lib";
import * as XLSX from "xlsx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const templateBytes = readFileSync(resolve("SampleDocuments/SampleOutput.pdf"));

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

function templateOptions(overrides = {}) {
  return {
    pdfLib: PDFLib,
    templateBytes,
    ...overrides,
  };
}

describe("RAK sample-template PDF renderer", () => {
  beforeEach(() => {
    vi.resetModules();
    delete globalThis.docuAlignWorkbookPdf;
    delete globalThis.docuAlignReportMapping;
    delete globalThis.docuAlignRakReportPdf;
    delete globalThis.PDFLib;
  });

  afterEach(() => {
    delete globalThis.docuAlignWorkbookPdf;
    delete globalThis.docuAlignReportMapping;
    delete globalThis.docuAlignRakReportPdf;
    delete globalThis.PDFLib;
    vi.unstubAllGlobals();
  });

  it("copies the exact five reference pages for the matching sample report", async () => {
    const reports = await sampleReports();
    const sample = reports.find((report) => report.groupIndex === 2);

    expect(globalThis.docuAlignRakReportPdf.matchesReferenceReport(sample)).toBe(true);
    const blob = await globalThis.docuAlignRakReportPdf.createRakReportPdf(
      [sample],
      templateOptions(),
    );
    const output = await PDFLib.PDFDocument.load(await blob.arrayBuffer());
    const template = await PDFLib.PDFDocument.load(templateBytes);

    expect(blob.type).toBe("application/pdf");
    expect(output.getPageCount()).toBe(5);
    expect(output.getPages().map((page) => page.getSize())).toEqual(
      template.getPages().map((page) => page.getSize()),
    );
  });

  it("builds overlays at the measured sample-PDF coordinates", async () => {
    const reports = await sampleReports();
    const sample = reports.find((report) => report.groupIndex === 2);
    const changed = {
      ...sample,
      jobRef: "X-2026-522-9",
      cover: {
        ...sample.cover,
        jobRef: "X-2026-522-9",
        clientName: "Replacement Client",
      },
    };

    expect(globalThis.docuAlignRakReportPdf.matchesReferenceReport(changed)).toBe(false);
    const plan = globalThis.docuAlignRakReportPdf.buildOverlayPlan(changed);

    expect(plan).toHaveLength(5);
    expect(plan[0].texts).toContainEqual(expect.objectContaining({
      text: "Replacement Client",
      x: 181.1,
      top: 139.64,
      size: 9.48,
    }));
    expect(plan[0].texts).toContainEqual(expect.objectContaining({
      text: "X-2026-522-9",
      x: 181.1,
      top: 457.21,
      bold: true,
    }));
    expect(plan[1]).toMatchObject({
      chart: { kind: "grading", x: 38.28, top: 277.5 },
    });
    expect(plan[2]).toMatchObject({
      charts: [
        { kind: "normal-shear", x: 38.28 },
        { kind: "displacement-shear", x: 289.5 },
      ],
    });
    expect(plan[4].images).toHaveLength(2);
  });

  it("combines all six workbook reports into 30 copied template pages", async () => {
    const reports = await sampleReports();

    const blob = await globalThis.docuAlignRakReportPdf.createRakReportPdf(
      reports,
      templateOptions(),
    );
    const output = await PDFLib.PDFDocument.load(await blob.arrayBuffer());

    expect(output.getPageCount()).toBe(30);
  });

  it("loads the template through browser globals in the production call shape", async () => {
    const reports = await sampleReports();
    const sample = reports.find((report) => report.groupIndex === 2);
    globalThis.PDFLib = PDFLib;
    const fetchMock = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () =>
        templateBytes.buffer.slice(
          templateBytes.byteOffset,
          templateBytes.byteOffset + templateBytes.byteLength,
        ),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const blob = await globalThis.docuAlignRakReportPdf.createRakReportPdf([sample]);

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining(
      "SampleDocuments/SampleOutput.pdf",
    ));
    expect(blob.type).toBe("application/pdf");
  });

  it("rejects missing reports, runtime libraries, and template responses", async () => {
    const reports = await sampleReports();
    const sample = reports[0];

    await expect(globalThis.docuAlignRakReportPdf.createRakReportPdf([])).rejects.toThrow(
      "at least one mapped report",
    );
    await expect(globalThis.docuAlignRakReportPdf.createRakReportPdf(
      [sample],
      { pdfLib: null, templateBytes },
    )).rejects.toThrow("PDF template library is unavailable");

    globalThis.PDFLib = PDFLib;
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404 })));
    await expect(globalThis.docuAlignRakReportPdf.createRakReportPdf([sample])).rejects.toThrow(
      "sample PDF template",
    );
  });
});
