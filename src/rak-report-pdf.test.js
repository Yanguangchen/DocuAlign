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
    globalThis.docuAlignLogger = { logInfo: vi.fn() };
  });

  afterEach(() => {
    delete globalThis.docuAlignWorkbookPdf;
    delete globalThis.docuAlignReportMapping;
    delete globalThis.docuAlignRakReportPdf;
    delete globalThis.PDFLib;
    delete globalThis.docuAlignLogger;
    vi.unstubAllGlobals();
  });

  it("renders only the lower and upper grading limits as dashed series", async () => {
    await import("./rak-report-pdf.js");

    expect(globalThis.docuAlignRakReportPdf.GRADING_SERIES_STYLES).toEqual({
      cumulativePassingPercent: {
        color: [0.31, 0.55, 0.78],
        dashArray: null,
      },
      lowerLimit: {
        color: [0.8, 0.3, 0.28],
        dashArray: [5, 3],
      },
      upperLimit: {
        color: [0.55, 0.72, 0.3],
        dashArray: [5, 3],
      },
    });
  });

  it("overlays even the report whose data equals the reference sample", async () => {
    const reports = await sampleReports();
    // Group 2 is the report SampleOutput.pdf was produced from. It must still
    // be built from the workbook: serving the reference pages untouched would
    // put one static report in the export, in the reference's own typography.
    const sample = reports.find((report) => report.groupIndex === 2);

    const blob = await globalThis.docuAlignRakReportPdf.createRakReportPdf(
      [sample],
      templateOptions(),
    );
    const output = await PDFLib.PDFDocument.load(await blob.arrayBuffer());
    const template = await PDFLib.PDFDocument.load(templateBytes);

    expect(blob.type).toBe("application/pdf");
    expect(output.getPageCount()).toBe(5);
    // The approved geometry still comes from the copied reference pages.
    expect(output.getPages().map((page) => page.getSize())).toEqual(
      template.getPages().map((page) => page.getSize()),
    );
    expect(globalThis.docuAlignLogger.logInfo).toHaveBeenCalledWith(
      "PDF template rendering completed",
      expect.objectContaining({
        reportCount: 1,
        copiedPageCount: 5,
        overlayReportCount: 1,
        valueMaskCount: expect.any(Number),
      }),
    );
    const [, telemetry] = globalThis.docuAlignLogger.logInfo.mock.calls.at(-1);
    expect(telemetry.valueMaskCount).toBeGreaterThan(0);
    expect(telemetry.imageOverlayCount).toBeGreaterThan(0);
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

    const plan = globalThis.docuAlignRakReportPdf.buildOverlayPlan(changed);

    expect(plan).toHaveLength(5);
    // Cover values carry the downward nudge that seats them on the reference's
    // own baselines, so each sits one nudge below its measurement.
    expect(plan[0].texts).toContainEqual(expect.objectContaining({
      text: "Replacement Client",
      x: 181.1,
      top: 139.64 + 0.225,
      size: 9.48,
    }));
    expect(plan[0].texts).toContainEqual(expect.objectContaining({
      text: "X-2026-522-9",
      x: 181.1,
      top: 457.21 + 0.225,
      bold: true,
    }));
    // The chart box matches the reference's own frame, which starts below the
    // table's bottom rule rather than across it.
    expect(plan[1]).toMatchObject({
      chart: { kind: "grading", x: 37.38, top: 276.38, width: 478.37, height: 177.0 },
    });
    expect(plan[2].charts.every((chart) => chart.top === 303.65)).toBe(true);
    // Replaced values are centred in their cell, not drawn at a fixed x.
    expect(plan[1].texts).toContainEqual(expect.objectContaining({
      align: "center",
      x: 152.5,
      width: 269.88 - 152.5,
    }));
    expect(plan[2]).toMatchObject({
      charts: [
        { kind: "normal-shear", x: 38.28 },
        { kind: "displacement-shear", x: 289.5 },
      ],
    });
    expect(plan[4].images).toHaveLength(2);
    const valueMasks = [
      plan[1].whiteouts.find((mask) => mask.x === 196),
      plan[2].whiteouts.find((mask) => mask.x === 409.7),
      plan[3].whiteouts.find((mask) => mask.x === 265),
    ];
    expect(valueMasks.every((mask) => mask.height <= 11.2)).toBe(true);
    expect(valueMasks[1]).toMatchObject({
      top: 128.66,
      height: 11.2,
    });

    const edgeReport = {
      ...changed,
      cover: {
        ...changed.cover,
        clientName: null,
        testMethods: ["MethodOnly", ...changed.cover.testMethods.slice(1)],
      },
      psd: {
        ...changed.psd,
        rows: [
          { ...changed.psd.rows[0], sieveSizeMm: "invalid" },
          ...changed.psd.rows.slice(1),
        ],
      },
      assets: {
        preparedSignature: null,
        authorisedSignature: null,
      },
      appendix: {
        ...changed.appendix,
        photos: [null, changed.appendix.photos[1], changed.appendix.photos[0]],
      },
    };
    const edgePlan = globalThis.docuAlignRakReportPdf.buildOverlayPlan(edgeReport);
    expect(edgePlan[0].texts).toContainEqual(expect.objectContaining({ text: "" }));
    expect(edgePlan[0].texts).toContainEqual(expect.objectContaining({ text: "MethodOnly" }));
    expect(edgePlan[4].images).toHaveLength(2);
    const edgeBlob = await globalThis.docuAlignRakReportPdf.createRakReportPdf(
      [edgeReport],
      templateOptions(),
    );
    expect(edgeBlob.type).toBe("application/pdf");
    expect(globalThis.docuAlignLogger.logInfo).toHaveBeenLastCalledWith(
      "PDF template rendering completed",
      expect.objectContaining({
        overlayReportCount: 1,
        valueMaskCount: expect.any(Number),
        maxValueMaskHeight: 11.2,
      }),
    );
  });

  it("combines all six workbook reports into 30 copied template pages", async () => {
    const reports = await sampleReports();

    const blob = await globalThis.docuAlignRakReportPdf.createRakReportPdf(
      reports,
      templateOptions(),
    );
    const output = await PDFLib.PDFDocument.load(await blob.arrayBuffer());

    expect(output.getPageCount()).toBe(30);
    expect(globalThis.docuAlignLogger.logInfo).toHaveBeenCalledWith(
      "PDF template rendering completed",
      expect.objectContaining({
        reportCount: 6,
        copiedPageCount: 30,
        // Every report is overlaid; none is served as the reference asset.
        overlayReportCount: 6,
      }),
    );
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

    const invalidTemplate = await PDFLib.PDFDocument.create();
    invalidTemplate.addPage();
    await expect(globalThis.docuAlignRakReportPdf.createRakReportPdf(
      [sample],
      templateOptions({ templateBytes: await invalidTemplate.save() }),
    )).rejects.toThrow("exactly five pages");
  });
});
