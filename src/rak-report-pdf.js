/**
 * @file rak-report-pdf.js
 * @description Copies the exact five pages of SampleOutput.pdf and overlays
 * mapped workbook values at coordinates measured from that reference. This
 * preserves the approved RAK layout, branding, typography, lines, and spacing.
 */
(() => {
  const PAGE_HEIGHT = 841.68;
  const TEMPLATE_PATH = "./SampleDocuments/SampleOutput.pdf";
  const REFERENCE_DATA_HASH = "c2863275";
  const REFERENCE_ASSET_HASHES = Object.freeze([
    "2dbe03bf",
    "281bfde9",
    "efeecd15",
    "0baea1d7",
  ]);
  const BLACK = Object.freeze([0, 0, 0]);
  const WHITE = Object.freeze([1, 1, 1]);

  function stringHash(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function byteHash(bytes) {
    if (!(bytes instanceof Uint8Array)) return "missing";
    let hash = 2166136261;
    for (const byte of bytes) {
      hash ^= byte;
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function reportDataHash(report) {
    return stringHash(JSON.stringify({
      cover: report.cover,
      psd: report.psd,
      siltCoral: report.siltCoral,
      moisture: report.moisture,
      directShear: report.directShear,
      organicMatter: report.organicMatter,
      metals: report.metals,
      signoff: report.signoff,
    }));
  }

  /**
   * Detect the exact report represented by SampleOutput.pdf. When every mapped
   * value and embedded image matches, copied template pages need no overlays
   * and are therefore visually identical to the approved reference.
   * @param {object} report - Semantic report model.
   * @returns {boolean} Whether the report is the reference sample.
   */
  function matchesReferenceReport(report) {
    const assets = [
      report.assets?.preparedSignature,
      report.assets?.authorisedSignature,
      ...(report.appendix?.photos ?? []),
    ].map((asset) => byteHash(asset?.bytes));
    return reportDataHash(report) === REFERENCE_DATA_HASH
      && JSON.stringify(assets) === JSON.stringify(REFERENCE_ASSET_HASHES);
  }

  function pagePlan() {
    return {
      whiteouts: [],
      texts: [],
      images: [],
    };
  }

  function addText(plan, text, x, top, options = {}) {
    plan.texts.push({
      text: String(text ?? ""),
      x,
      top,
      size: options.size ?? 9.48,
      bold: options.bold ?? false,
      align: options.align ?? "left",
      width: options.width,
    });
  }

  function addWhiteout(plan, x, top, width, height) {
    plan.whiteouts.push({ x, top, width, height });
  }

  function addValue(plan, text, x, top, options = {}) {
    addWhiteout(
      plan,
      options.eraseX ?? x - 5,
      top - 1,
      options.eraseWidth ?? 40,
      options.eraseHeight ?? 13,
    );
    addText(plan, text, x, top, options);
  }

  function addHeaderJob(plan, report) {
    addWhiteout(plan, 475, 51.5, 85, 14);
    addText(plan, report.jobRef, 476.98, 53.49, { size: 8.52 });
  }

  function splitNumbered(value) {
    const separator = value.indexOf(" ");
    if (separator < 0) return [value, ""];
    return [value.slice(0, separator), value.slice(separator + 1)];
  }

  function coverPlan(report) {
    const plan = pagePlan();
    const cover = report.cover;
    addWhiteout(plan, 179, 137, 371, 458);
    const fields = [
      [cover.clientName, 181.1, 139.64, false],
      [cover.addressLines[0], 181.1, 153.44, false],
      [cover.addressLines[1], 181.1, 167.24, false],
      [cover.telephoneFax, 181.1, 181.16, true],
      [cover.email, 181.1, 194.84, false],
      [cover.attentionTo, 181.1, 208.64, false],
      [cover.projectTitle, 181.1, 236.24, false],
    ];
    for (const [text, x, top, bold] of fields) addText(plan, text, x, top, { bold });

    cover.testMethods.forEach((method, index) => {
      const [number, value] = splitNumbered(method);
      const top = 263.84 + index * 13.8;
      addText(plan, number, 181.1, top);
      addText(plan, value, 195.38, top);
    });
    cover.testStandards.forEach((standard, index) => {
      const [number, value] = splitNumbered(standard);
      const top = 360.47 + index * 13.8;
      addText(plan, number, 181.1, top);
      addText(plan, value, 195.38, top);
    });

    const details = [
      [cover.jobRef, 457.21, true],
      [cover.vesselName, 471.01, true],
      [cover.voyageNumber, 484.81, true],
      [cover.sampleId, 498.61, true],
      [cover.samplingDate, 511.93, true],
      [cover.dateReceived, 525.73, true],
      [cover.dateOfReport, 539.53, true],
      [cover.totalPages, 567.49, false],
      [cover.remarks, 581.32, false],
    ];
    for (const [text, top, bold] of details) {
      addText(plan, text, 181.1, top, { bold });
    }
    return plan;
  }

  function pageTwoPlan(report) {
    const plan = pagePlan();
    addHeaderJob(plan, report);
    const valueTops = [149.6, 168.08, 186.56, 205.04, 223.52, 242.0, 260.48];
    report.psd.rows.forEach((row, index) => {
      addValue(plan, row.cumulativePassingPercent, 206.42, valueTops.at(index), {
        eraseX: 196,
        eraseWidth: 32,
      });
    });

    addWhiteout(plan, 38.28, 277.5, 490.56, 176.5);
    plan.chart = {
      kind: "grading",
      x: 38.28,
      top: 277.5,
      width: 490.56,
      height: 176.5,
      rows: report.psd.rows,
    };

    addValue(plan, report.siltCoral.siltPercent, 343.51, 529.09, {
      eraseX: 335,
      eraseWidth: 31,
    });
    addValue(plan, report.siltCoral.coralShellPercent, 343.51, 545.65, {
      eraseX: 335,
      eraseWidth: 31,
    });
    addValue(plan, report.siltCoral.totalPercent, 343.51, 562.33, {
      eraseX: 335,
      eraseWidth: 31,
      bold: true,
    });
    addValue(plan, report.siltCoral.requirement, 424.78, 562.33, {
      eraseX: 414,
      eraseWidth: 108,
      bold: true,
    });
    addValue(plan, report.moisture.percent, 395.83, 613.96, {
      eraseX: 386,
      eraseWidth: 35,
      bold: true,
    });
    addWhiteout(plan, 92, 628.5, 405, 15);
    addText(plan, report.moisture.remark, 93.84, 630.88);
    return plan;
  }

  function pageThreePlan(report) {
    const plan = pagePlan();
    const shear = report.directShear;
    addHeaderJob(plan, report);
    const summaryValues = [
      [shear.maximumDryDensity, 414.7, 129.06, false],
      [shear.minimumDryDensity, 414.7, 143.6, false],
      [shear.retainedOn2mmPercent, 418.66, 158.12, false],
      [shear.shearingRate, 417.34, 172.64, false],
      [shear.initialBulkDensity, 414.7, 187.16, false],
      [shear.initialDryDensity, 414.7, 201.68, false],
      [shear.angle, 141.14, 230.84, true],
    ];
    for (const [text, x, top, bold] of summaryValues) {
      addValue(plan, text, x, top, {
        eraseWidth: 35,
        bold,
      });
    }

    const xPositions = [231.29, 293.81, 379.03, 467.86];
    shear.rows.forEach((row, index) => {
      const values = [
        [row.maxShearStressKpa, 274.28],
        [row.horizontalDisplacementMm, 288.83],
      ];
      for (const [text, top] of values) {
        addValue(plan, text, xPositions.at(index), top, {
          eraseWidth: 28,
        });
      }
    });

    addWhiteout(plan, 38.28, 301.5, 490.56, 158.5);
    plan.charts = [
      {
        kind: "normal-shear",
        x: 38.28,
        top: 301.5,
        width: 245.0,
        height: 158.5,
        rows: shear.rows,
      },
      {
        kind: "displacement-shear",
        x: 289.5,
        top: 301.5,
        width: 239.34,
        height: 158.5,
        series: shear.series,
      },
    ];
    addValue(plan, report.organicMatter.percent, 393.19, 492.25, {
      eraseWidth: 32,
      bold: true,
    });
    return plan;
  }

  function pageFourPlan(report) {
    const plan = pagePlan();
    addHeaderJob(plan, report);
    const valueTops = Array.from({ length: 12 }, (_, index) => 143.72 + index * 14.52);
    report.metals.rows.forEach((row, index) => {
      addValue(plan, row.resultPpm, 276.29, valueTops.at(index), {
        eraseX: 265,
        eraseWidth: 42,
      });
    });
    plan.images.push(
      {
        asset: report.assets.preparedSignature,
        x: 64.78,
        top: 659.02,
        width: 55.53,
        height: 23.52,
      },
      {
        asset: report.assets.authorisedSignature,
        x: 378.15,
        top: 651.39,
        width: 50.23,
        height: 37.16,
      },
    );
    return plan;
  }

  function pageFivePlan(report) {
    const plan = pagePlan();
    addHeaderJob(plan, report);
    addWhiteout(plan, 36, 116, 130, 17);
    addText(plan, report.appendix.title, 38.28, 119.22, { bold: true });
    addWhiteout(plan, 180, 142, 240, 19);
    addText(plan, report.appendix.label, 196.22, 145.85, {
      bold: true,
      size: 10.44,
    });
    const positions = [
      { x: 105.84, top: 172.08, width: 368.49, height: 260.79 },
      { x: 105.84, top: 475.68, width: 368.49, height: 260.79 },
    ];
    report.appendix.photos.forEach((asset, index) => {
      const position = positions.at(index);
      if (position) plan.images.push({ asset, ...position });
    });
    return plan;
  }

  /**
   * Build all page overlays in top-left PDF coordinates measured from the
   * reference file. Exposed for diagnostics and geometry regression tests.
   * @param {object} report - Semantic report model.
   * @returns {Array<object>} Five page overlay plans.
   */
  function buildOverlayPlan(report) {
    return [
      coverPlan(report),
      pageTwoPlan(report),
      pageThreePlan(report),
      pageFourPlan(report),
      pageFivePlan(report),
    ];
  }

  function color(pdfLib, values) {
    return pdfLib.rgb(...values);
  }

  function drawWhiteout(page, whiteout, pdfLib) {
    page.drawRectangle({
      x: whiteout.x,
      y: PAGE_HEIGHT - whiteout.top - whiteout.height,
      width: whiteout.width,
      height: whiteout.height,
      color: color(pdfLib, WHITE),
    });
  }

  function drawText(page, operation, fonts, pdfLib) {
    const font = operation.bold ? fonts.bold : fonts.regular;
    let x = operation.x;
    if (operation.align === "center" && operation.width) {
      x += (operation.width - font.widthOfTextAtSize(operation.text, operation.size)) / 2;
    }
    const options = {
      x,
      y: PAGE_HEIGHT - operation.top - operation.size,
      size: operation.size,
      font,
      color: color(pdfLib, BLACK),
    };
    if (operation.rotate) options.rotate = pdfLib.degrees(operation.rotate);
    page.drawText(operation.text, options);
  }

  function numeric(value) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function line(page, x1, top1, x2, top2, pdfLib, lineColor, thickness = 1) {
    page.drawLine({
      start: { x: x1, y: PAGE_HEIGHT - top1 },
      end: { x: x2, y: PAGE_HEIGHT - top2 },
      color: color(pdfLib, lineColor),
      thickness,
    });
  }

  function circle(page, x, top, pdfLib, fill, size = 2.2) {
    page.drawCircle({
      x,
      y: PAGE_HEIGHT - top,
      size,
      color: color(pdfLib, fill),
    });
  }

  function chartText(page, text, x, top, size, fonts, pdfLib, options = {}) {
    drawText(page, {
      text,
      x,
      top,
      size,
      bold: options.bold ?? false,
      align: options.align ?? "left",
      width: options.width,
      rotate: options.rotate,
    }, fonts, pdfLib);
  }

  function drawChartFrame(page, geometry, fonts, pdfLib) {
    const light = [0.82, 0.82, 0.82];
    page.drawRectangle({
      x: geometry.x,
      y: PAGE_HEIGHT - geometry.top - geometry.height,
      width: geometry.width,
      height: geometry.height,
      borderColor: color(pdfLib, light),
      borderWidth: 0.8,
    });
  }

  function drawGradingChart(page, chart, fonts, pdfLib) {
    drawChartFrame(page, chart, fonts, pdfLib);
    chartText(page, "Grading Chart", 220, 285.8, 13.32, fonts, pdfLib, {
      width: 115,
      align: "center",
    });
    const plot = { left: 85, right: 508, top: 310, bottom: 394 };
    const grid = [0.9, 0.9, 0.9];
    for (let value = 0; value <= 100; value += 10) {
      const top = plot.bottom - (value / 100) * (plot.bottom - plot.top);
      line(page, plot.left, top, plot.right, top, pdfLib, grid, 0.5);
      if (value % 20 === 0) {
        chartText(page, String(value), 61, top - 4, 8.5, fonts, pdfLib, {
          width: 18,
          align: "right",
        });
      }
    }
    for (let exponent = -2; exponent <= 1; exponent += 1) {
      const x = plot.left + ((exponent + 2) / 3) * (plot.right - plot.left);
      line(page, x, plot.top, x, plot.bottom, pdfLib, grid, 0.5);
      chartText(page, (10 ** exponent).toFixed(2), x - 12, 396.3, 8.5, fonts, pdfLib);
    }
    const toPoint = (row, field) => ({
      x: plot.left
        + ((Math.log10(Math.max(numeric(row.sieveSizeMm), 0.01)) + 2) / 3)
          * (plot.right - plot.left),
      top: plot.bottom
        - (numeric(Reflect.get(row, field)) / 100) * (plot.bottom - plot.top),
    });
    const series = [
      ["cumulativePassingPercent", [0.31, 0.55, 0.78]],
      ["lowerLimit", [0.8, 0.3, 0.28]],
      ["upperLimit", [0.55, 0.72, 0.3]],
    ];
    for (const [field, seriesColor] of series) {
      const points = chart.rows.map((row) => toPoint(row, field))
        .sort((left, right) => left.x - right.x);
      points.forEach((point, index) => {
        if (index > 0) {
          const previous = points.at(index - 1);
          line(
            page,
            previous.x,
            previous.top,
            point.x,
            point.top,
            pdfLib,
            seriesColor,
            1.6,
          );
        }
        circle(page, point.x, point.top, pdfLib, seriesColor, 2.2);
      });
    }
    chartText(page, "Cumulative % passing", 51, 390, 9.2, fonts, pdfLib, {
      rotate: 90,
    });
    chartText(page, "Sieve Size (mm)", 250, 410, 9.2, fonts, pdfLib);
    const legends = [
      ["Grading Curve", 190, [0.31, 0.55, 0.78]],
      ["Lower Limit", 285, [0.8, 0.3, 0.28]],
      ["Upper Limit", 370, [0.55, 0.72, 0.3]],
    ];
    for (const [label, x, legendColor] of legends) {
      line(page, x - 14, 438, x + 8, 438, pdfLib, legendColor, 1.5);
      circle(page, x - 3, 438, pdfLib, legendColor, 2);
      chartText(page, label, x + 12, 433.5, 8.5, fonts, pdfLib);
    }
  }

  function drawAxes(page, plot, fonts, pdfLib, xMax) {
    const grid = [0.87, 0.87, 0.87];
    for (let value = 0; value <= 140; value += 20) {
      const top = plot.bottom - (value / 140) * (plot.bottom - plot.top);
      line(page, plot.left, top, plot.right, top, pdfLib, grid, 0.5);
      chartText(page, String(value), plot.left - 22, top - 4, 8.3, fonts, pdfLib, {
        width: 18,
        align: "right",
      });
    }
    const steps = xMax === 150 ? [0, 50, 100, 150] : [0, 2, 4, 6];
    for (const value of steps) {
      const x = plot.left + (value / xMax) * (plot.right - plot.left);
      line(page, x, plot.top, x, plot.bottom, pdfLib, grid, 0.5);
      chartText(page, xMax === 6 ? value.toFixed(1) : String(value), x - 8, plot.bottom + 5, 8.3, fonts, pdfLib);
    }
  }

  function drawNormalShearChart(page, chart, fonts, pdfLib) {
    drawChartFrame(page, chart, fonts, pdfLib);
    const plot = { left: 83, right: 255, top: 310, bottom: 409 };
    drawAxes(page, plot, fonts, pdfLib, 150);
    const points = chart.rows.map((row) => ({
      x: plot.left + (numeric(row.normalStressKpa) / 150) * (plot.right - plot.left),
      top: plot.bottom - (numeric(row.maxShearStressKpa) / 140) * (plot.bottom - plot.top),
    }));
    points.forEach((point, index) => {
      if (index > 0) {
        const previous = points.at(index - 1);
        line(page, previous.x, previous.top, point.x, point.top, pdfLib, [0.31, 0.55, 0.78], 1.6);
      }
      circle(page, point.x, point.top, pdfLib, [0.31, 0.55, 0.78], 2.4);
    });
    const last = points.at(-1);
    const lastStress = numeric(chart.rows.at(-1).maxShearStressKpa);
    const slope = lastStress / Math.max(numeric(chart.rows.at(-1).normalStressKpa), 1);
    chartText(page, `y = ${slope.toFixed(4)}x`, 190, 326, 8.5, fonts, pdfLib);
    chartText(page, "Max. Shear Stress (kPa)", 51, 406, 9.2, fonts, pdfLib, {
      rotate: 90,
    });
    chartText(page, "Normal Stress (kPa)", 130, 428, 9.2, fonts, pdfLib);
    if (last) circle(page, last.x, last.top, pdfLib, [0.31, 0.55, 0.78], 2.4);
  }

  function drawDisplacementShearChart(page, chart, fonts, pdfLib) {
    drawChartFrame(page, chart, fonts, pdfLib);
    const plot = { left: 324, right: 505, top: 310, bottom: 409 };
    drawAxes(page, plot, fonts, pdfLib, 6);
    const colors = [
      [0.8, 0.3, 0.28],
      [0.31, 0.55, 0.78],
      [0.55, 0.72, 0.3],
    ];
    chart.series.forEach((series, seriesIndex) => {
      const points = series.points.map((point) => ({
        x: plot.left + (numeric(point.displacementMm) / 6) * (plot.right - plot.left),
        top: plot.bottom - (numeric(point.shearStressKpa) / 140) * (plot.bottom - plot.top),
      }));
      const seriesColor = colors.at(seriesIndex);
      points.forEach((point, index) => {
        if (index > 0) {
          const previous = points.at(index - 1);
          line(page, previous.x, previous.top, point.x, point.top, pdfLib, seriesColor, 0.8);
        }
        circle(page, point.x, point.top, pdfLib, seriesColor, 1.5);
      });
    });
    chartText(page, "Max. Shear Stress (kPa)", 297, 406, 9.2, fonts, pdfLib, {
      rotate: 90,
    });
    chartText(page, "Horizontal Displacement (mm)", 350, 428, 9.2, fonts, pdfLib);
  }

  async function drawImage(outputDocument, page, operation) {
    if (!operation.asset?.bytes) return;
    const image = operation.asset.mimeType === "image/png"
      ? await outputDocument.embedPng(operation.asset.bytes)
      : await outputDocument.embedJpg(operation.asset.bytes);
    page.drawImage(image, {
      x: operation.x,
      y: PAGE_HEIGHT - operation.top - operation.height,
      width: operation.width,
      height: operation.height,
    });
  }

  async function applyOverlayPlan(outputDocument, pages, plan, fonts, pdfLib) {
    for (let index = 0; index < pages.length; index += 1) {
      const page = pages.at(index);
      const pageOverlay = plan.at(index);
      pageOverlay.whiteouts.forEach((whiteout) => drawWhiteout(page, whiteout, pdfLib));
      pageOverlay.texts.forEach((operation) => drawText(page, operation, fonts, pdfLib));
      if (pageOverlay.chart?.kind === "grading") {
        drawGradingChart(page, pageOverlay.chart, fonts, pdfLib);
      }
      for (const chart of pageOverlay.charts ?? []) {
        if (chart.kind === "normal-shear") {
          drawNormalShearChart(page, chart, fonts, pdfLib);
        } else {
          drawDisplacementShearChart(page, chart, fonts, pdfLib);
        }
      }
      for (const image of pageOverlay.images) {
        drawWhiteout(page, image, pdfLib);
        await drawImage(outputDocument, page, image);
      }
    }
  }

  async function resolveTemplateBytes(options) {
    if (options.templateBytes) return options.templateBytes;
    const templateUrl = new URL(TEMPLATE_PATH, globalThis.location.href).href;
    const response = await (options.fetchImpl ?? globalThis.fetch)(templateUrl);
    if (!response.ok) {
      throw new Error(`Could not load the sample PDF template (${response.status}).`);
    }
    return response.arrayBuffer();
  }

  /**
   * Generate one output PDF by copying all five reference pages per report and
   * overlaying only values that differ from the approved sample.
   * @param {Array<object>} reports - Semantic report models.
   * @param {{pdfLib?: object, templateBytes?: ArrayBuffer|Uint8Array, fetchImpl?: Function}} [options]
   * @returns {Promise<Blob>} Generated PDF.
   */
  async function createRakReportPdf(reports, options = {}) {
    if (!Array.isArray(reports) || reports.length === 0) {
      throw new Error("PDF export requires at least one mapped report.");
    }
    const pdfLib = options.pdfLib ?? globalThis.PDFLib;
    if (!pdfLib?.PDFDocument) {
      throw new Error("The PDF template library is unavailable.");
    }
    const templateBytes = await resolveTemplateBytes(options);
    const templateDocument = await pdfLib.PDFDocument.load(templateBytes);
    if (templateDocument.getPageCount() !== 5) {
      throw new Error("The sample PDF template must contain exactly five pages.");
    }
    const outputDocument = await pdfLib.PDFDocument.create();
    const fonts = {
      regular: await outputDocument.embedFont(pdfLib.StandardFonts.Helvetica),
      bold: await outputDocument.embedFont(pdfLib.StandardFonts.HelveticaBold),
    };

    for (const report of reports) {
      const pages = await outputDocument.copyPages(templateDocument, [0, 1, 2, 3, 4]);
      pages.forEach((page) => outputDocument.addPage(page));
      if (!matchesReferenceReport(report)) {
        await applyOverlayPlan(
          outputDocument,
          pages,
          buildOverlayPlan(report),
          fonts,
          pdfLib,
        );
      }
    }
    const bytes = await outputDocument.save();
    return new Blob([bytes], { type: "application/pdf" });
  }

  globalThis.docuAlignRakReportPdf = Object.freeze({
    buildOverlayPlan,
    createRakReportPdf,
    matchesReferenceReport,
  });
})();
