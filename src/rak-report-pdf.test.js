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
/** The reference pages' own height, which every overlay is measured against. */
const PAGE_HEIGHT = 841.68;

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

/**
 * The drawing operators one rendered page carries, as text.
 * @param {object} document - Loaded output document.
 * @param {number} index - Zero-based page number.
 * @returns {string} The page's decoded content streams.
 */
function pageOperators(document, index) {
  const contents = document.getPage(index).node.Contents();
  const streams = contents instanceof PDFLib.PDFArray
    ? contents.asArray().map((reference) => document.context.lookup(reference))
    : [contents];
  return streams
    .map((stream) => new TextDecoder().decode(PDFLib.decodePDFRawStream(stream).decode()))
    .join("\n");
}

/** Every clipping rectangle a page establishes, as `[x, y, width, height]`. */
function clipBoxes(operators) {
  return [...operators.matchAll(/(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) re\nW\nn/g)]
    .map((match) => match.slice(1, 5).map(Number));
}

/** Where each overlaid picture is drawn, as `[x, y, width, height]`. */
function drawnImages(operators) {
  const placement = new RegExp(
    "1 0 0 1 (-?[\\d.]+) (-?[\\d.]+) cm\\n1 0 0 1 0 0 cm\\n"
    + "(-?[\\d.]+) 0 0 (-?[\\d.]+) 0 0 cm\\n1 0 0 1 0 0 cm\\n/Image-[\\w-]+ Do",
    "g",
  );
  return [...operators.matchAll(placement)].map((match) => [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
  ]);
}

describe("RAK sample-template PDF renderer", () => {
  beforeEach(async () => {
    vi.resetModules();
    // Both pages load the shared text helper before the renderer, as `drawText`
    // reads it from the global scope the way the classic scripts do.
    await import("./pdf-text.js");
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
        { kind: "displacement-shear", x: 283.13 },
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

  it("never leaves the reference sample's photographs on a report without its own", async () => {
    const [sample] = await sampleReports();
    // The exact production failure: everything else maps, but the photographs
    // arrive with no bytes (a refused Storage upload, or a fetch that failed).
    // The reference page must NOT keep its own photographs here -- doing so
    // attributes another vessel's sample to this report, invisibly.
    const withoutPhotos = {
      ...sample,
      appendix: {
        ...sample.appendix,
        photos: sample.appendix.photos.map((photo) => ({ ...photo, bytes: undefined })),
      },
    };

    const plan = globalThis.docuAlignRakReportPdf.buildOverlayPlan(withoutPhotos);
    const appendixImages = plan[4].images;
    expect(appendixImages).toHaveLength(2);
    expect(appendixImages.every((image) => image.evidence)).toBe(true);

    const blob = await globalThis.docuAlignRakReportPdf.createRakReportPdf(
      [withoutPhotos],
      templateOptions(),
    );
    const bytes = Buffer.from(await blob.arrayBuffer());

    // The reference sample's photograph bytes must be absent from the output.
    sample.appendix.photos.forEach((photo) => {
      expect(bytes.includes(Buffer.from(photo.bytes))).toBe(false);
    });
    // Signatures are identical across every report RAK issues, so the
    // reference's own are still correct and are deliberately kept.
    expect(plan[3].images.every((image) => image.evidence)).toBe(false);
  });

  it("draws a signature the way Excel crops it, clipped to the reference's box", async () => {
    const reports = await sampleReports();
    const sample = reports.find((report) => report.groupIndex === 2);
    // The workbook's authorised signature is a screenshot that caught the
    // neighbouring cell's gridline down its right edge and along its bottom.
    // Excel hides that edge; drawing the file whole puts a grey rule across
    // the sign-off line of a signed report.
    expect(sample.assets.authorisedSignature.crop).toEqual({
      left: 0,
      top: 0,
      right: 0.11923,
      bottom: 0.08152,
    });
    expect(sample.assets.preparedSignature.crop).toBeUndefined();

    const blob = await globalThis.docuAlignRakReportPdf.createRakReportPdf(
      [sample],
      templateOptions(),
    );
    const output = await PDFLib.PDFDocument.load(await blob.arrayBuffer());
    const operators = pageOperators(output, 3);

    // The sign-off page's box is the measured one, and the visible part of the
    // picture fills it exactly: the whole file is enlarged by the crop it
    // hides, offset so the visible part lands on the box, and clipped back to
    // it so the hidden edge cannot spill onto the page.
    const boxTop = PAGE_HEIGHT - 651.39 - 37.16;
    const clips = clipBoxes(operators);
    expect(clips).toHaveLength(1);
    const [clipX, clipY, clipWidth, clipHeight] = clips[0];
    expect(clipX).toBeCloseTo(378.15, 6);
    expect(clipY).toBeCloseTo(boxTop, 6);
    expect(clipWidth).toBeCloseTo(50.23, 6);
    expect(clipHeight).toBeCloseTo(37.16, 6);

    const [prepared, authorised] = drawnImages(operators);
    const [preparedX, , preparedWidth, preparedHeight] = prepared;
    const [authorisedX, authorisedY, authorisedWidth, authorisedHeight] = authorised;
    // The uncropped signature is still drawn as its box, untouched.
    expect(preparedX).toBeCloseTo(64.78, 6);
    expect(preparedWidth).toBeCloseTo(55.53, 6);
    expect(preparedHeight).toBeCloseTo(23.52, 6);
    expect(authorisedWidth).toBeCloseTo(50.23 / (1 - 0.11923), 6);
    expect(authorisedHeight).toBeCloseTo(37.16 / (1 - 0.08152), 6);
    // Nothing is trimmed from the left, so the enlargement runs rightwards
    // off the box; the bottom trim pushes the picture down by its own share.
    expect(authorisedX).toBeCloseTo(378.15, 6);
    expect(authorisedY).toBeCloseTo(boxTop - (0.08152 * authorisedHeight), 6);
  });

  it("draws a picture whole when its crop is not one Excel could have written", async () => {
    const reports = await sampleReports();
    const sample = reports.find((report) => report.groupIndex === 2);
    // A published share carries the mapped model as JSON, so a crop reaching
    // the renderer has been out of the app and back. Anything that is not a
    // crop draws the picture whole rather than scaling by a nonsense divisor.
    const rejected = [
      undefined,
      "11923",
      { left: -0.2 },
      { left: "gridline" },
      { left: 0.6, right: 0.5 },
      { top: 0.52, bottom: 0.5 },
      { left: 0, top: 0, right: 0, bottom: 0 },
    ];

    for (const crop of rejected) {
      const report = {
        ...sample,
        assets: {
          ...sample.assets,
          authorisedSignature: { ...sample.assets.authorisedSignature, crop },
        },
      };
      const blob = await globalThis.docuAlignRakReportPdf.createRakReportPdf(
        [report],
        templateOptions(),
      );
      const output = await PDFLib.PDFDocument.load(await blob.arrayBuffer());
      const operators = pageOperators(output, 3);

      expect(clipBoxes(operators)).toEqual([]);
      const [, , width, height] = drawnImages(operators).at(1);
      expect(width).toBeCloseTo(50.23, 6);
      expect(height).toBeCloseTo(37.16, 6);
    }
  });

  it("draws a workbook requirement's comparison symbol from the Symbol font", async () => {
    const reports = await sampleReports();
    const sample = reports.find((report) => report.groupIndex === 1);
    // A workbook is free to write this requirement the way the Summary writes
    // its own limit -- as an underlined "<", which the reader resolves to a
    // symbol Helvetica's WinAnsi encoding has no glyph for. pdf-lib rejects the
    // page outright on such a character, so this renders at all only because
    // the renderer hands that one character to the Symbol font.
    const withSymbol = {
      ...sample,
      siltCoral: { ...sample.siltCoral, requirement: "\u2264 15%" },
    };

    const blob = await globalThis.docuAlignRakReportPdf.createRakReportPdf(
      [withSymbol],
      templateOptions(),
    );
    const output = await PDFLib.PDFDocument.load(await blob.arrayBuffer());

    expect(output.getPageCount()).toBe(5);
    const baseFonts = output.context
      .enumerateIndirectObjects()
      .map(([, object]) => object?.get?.(PDFLib.PDFName.of("BaseFont")))
      .filter(Boolean)
      .map(String);
    expect(baseFonts).toContain("/Symbol");
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
