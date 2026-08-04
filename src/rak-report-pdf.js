/**
 * @file rak-report-pdf.js
 * @description Copies the exact five pages of SampleOutput.pdf and overlays
 * mapped workbook values at coordinates measured from that reference. This
 * preserves the approved RAK layout, branding, typography, lines, and spacing.
 */
(() => {
  const PAGE_HEIGHT = 841.68;
  const TEMPLATE_PATH = "./SampleDocuments/SampleOutput.pdf";

  /**
   * Downward nudge applied to the cover page's values, in PDF points. Started
   * at 0.75pt (one screen pixel by the naive 72/96 ratio, which read as two
   * pixels and sat low), halved to 0.375pt, and now nudged back up by 0.2px
   * (0.15pt at 96dpi) to 0.225pt.
   */
  const COVER_TEXT_NUDGE = 0.225;
  const BLACK = Object.freeze([0, 0, 0]);
  const WHITE = Object.freeze([1, 1, 1]);
  const GRADING_SERIES_STYLES = Object.freeze({
    cumulativePassingPercent: Object.freeze({
      color: Object.freeze([0.31, 0.55, 0.78]),
      dashArray: null,
    }),
    lowerLimit: Object.freeze({
      color: Object.freeze([0.8, 0.3, 0.28]),
      dashArray: Object.freeze([5, 3]),
    }),
    upperLimit: Object.freeze({
      color: Object.freeze([0.55, 0.72, 0.3]),
      dashArray: Object.freeze([5, 3]),
    }),
  });

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

  function addWhiteout(plan, x, top, width, height, kind = "region") {
    plan.whiteouts.push({ x, top, width, height, kind });
  }

  /**
   * Replace one table cell's value.
   *
   * The reference centres every value inside its own cell, so `cell` gives the
   * span between that cell's vertical rules and the replacement is centred in
   * it. Drawing at a fixed x instead only looks centred for values the same
   * width as the sample's -- a shorter or longer number sits visibly off.
   */
  function addValue(plan, text, x, top, options = {}) {
    addWhiteout(
      plan,
      options.eraseX ?? x - 5,
      top - 0.4,
      options.eraseWidth,
      11.2,
      "value-mask",
    );
    const [left, right] = options.cell;
    addText(plan, text, left, top, Object.assign({}, options, {
      align: "center",
      width: right - left,
    }));
  }

  /** Cell spans measured from the reference report, in PDF points. */
  const CELLS = Object.freeze({
    psdPassing: Object.freeze([152.5, 269.88]),
    siltCoral: Object.freeze([285.12, 414.25]),
    siltRequirement: Object.freeze([415.12, 518.88]),
    wideResult: Object.freeze([285.12, 518.88]),
    shearSummary: Object.freeze([328.0, 518.88]),
    shearAngle: Object.freeze([36.88, 255.0]),
    shearStress: Object.freeze([
      Object.freeze([211.88, 255.0]),
      Object.freeze([255.88, 341.38]),
      Object.freeze([342.25, 430.75]),
      Object.freeze([431.62, 518.88]),
    ]),
    metalResult: Object.freeze([197.62, 369.88]),
  });

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

    // Every cover value sits a hair high against the reference's own baselines,
    // so the whole block is nudged down by COVER_TEXT_NUDGE. Applying it here,
    // once, keeps the individual coordinates as measured from the reference.
    plan.texts.forEach((operation) => {
      operation.top += COVER_TEXT_NUDGE;
    });
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
        cell: CELLS.psdPassing,
      });
    });

    // The chart box is measured from the reference page: its frame spans
    // 37.38 to 515.75 horizontally and starts immediately below the table's
    // bottom rule (which ends at 276.0), running to 453.8. Clearing or drawing
    // outside that span either leaves the reference's own frame showing beside
    // the redrawn one, or paints over the table above.
    addWhiteout(plan, 37.0, 276.05, 479.5, 178.0);
    plan.chart = {
      kind: "grading",
      x: 37.38,
      top: 276.38,
      width: 478.37,
      height: 177.0,
      rows: report.psd.rows,
    };

    addValue(plan, report.siltCoral.siltPercent, 343.51, 529.09, {
      eraseX: 335,
      eraseWidth: 31,
      cell: CELLS.siltCoral,
    });
    addValue(plan, report.siltCoral.coralShellPercent, 343.51, 545.65, {
      eraseX: 335,
      eraseWidth: 31,
      cell: CELLS.siltCoral,
    });
    addValue(plan, report.siltCoral.totalPercent, 343.51, 562.33, {
      eraseX: 335,
      eraseWidth: 31,
      bold: true,
      cell: CELLS.siltCoral,
    });
    // The mask stays inside the cell's own rules: reaching to 414 would paint
    // over the column separator and the table's right border, which nothing
    // redraws afterwards.
    addValue(plan, report.siltCoral.requirement, 424.78, 562.33, {
      eraseX: 416,
      eraseWidth: 102,
      bold: true,
      cell: CELLS.siltRequirement,
    });
    addValue(plan, report.moisture.percent, 395.83, 613.96, {
      eraseX: 386,
      eraseWidth: 35,
      bold: true,
      cell: CELLS.wideResult,
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
      [shear.maximumDryDensity, 414.7, 129.06, false, CELLS.shearSummary],
      [shear.minimumDryDensity, 414.7, 143.6, false, CELLS.shearSummary],
      [shear.retainedOn2mmPercent, 418.66, 158.12, false, CELLS.shearSummary],
      [shear.shearingRate, 417.34, 172.64, false, CELLS.shearSummary],
      [shear.initialBulkDensity, 414.7, 187.16, false, CELLS.shearSummary],
      [shear.initialDryDensity, 414.7, 201.68, false, CELLS.shearSummary],
      [shear.angle, 141.14, 230.84, true, CELLS.shearAngle],
    ];
    for (const [text, x, top, bold, cell] of summaryValues) {
      addValue(plan, text, x, top, {
        eraseWidth: 35,
        bold,
        cell,
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
          cell: CELLS.shearStress.at(index),
        });
      }
    });

    // Measured from the reference page: the shear table's bottom rule ends at
    // 302.2 and the chart frames run 303.25 to 451.05. The mask used to start
    // at 301.5, inside that rule, so the table lost its bottom border and the
    // chart frame was drawn across it.
    addWhiteout(plan, 37.2, 302.6, 474.4, 148.45);
    plan.charts = [
      {
        kind: "normal-shear",
        x: 38.28,
        top: 303.65,
        width: 238.5,
        height: 147.0,
        rows: shear.rows,
      },
      {
        kind: "displacement-shear",
        x: 283.13,
        top: 303.65,
        width: 228.25,
        height: 147.0,
        series: shear.series,
      },
    ];
    addValue(plan, report.organicMatter.percent, 393.19, 492.25, {
      eraseWidth: 32,
      bold: true,
      cell: CELLS.wideResult,
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
        cell: CELLS.metalResult,
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
    // Axis values are right-aligned so their digits end on a common edge, as
    // the reference sets them; without this they ragged-left instead.
    const slack = operation.width
      ? operation.width - font.widthOfTextAtSize(operation.text, operation.size)
      : 0;
    if (operation.align === "center") x += slack / 2;
    else if (operation.align === "right") x += slack;
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

  function line(
    page,
    x1,
    top1,
    x2,
    top2,
    pdfLib,
    lineColor,
    thickness = 1,
    dashArray = null,
  ) {
    const options = {
      start: { x: x1, y: PAGE_HEIGHT - top1 },
      end: { x: x2, y: PAGE_HEIGHT - top2 },
      color: color(pdfLib, lineColor),
      thickness,
    };
    if (dashArray) {
      options.dashArray = dashArray;
      options.dashPhase = 0;
    }
    page.drawLine(options);
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

  /**
   * Grading chart geometry, measured from the reference page. The plot body is
   * shorter than a naive full-height box, the horizontal grid steps every 4%,
   * and the sieve axis carries a full logarithmic minor grid (2..9 inside each
   * decade) with the decade lines and the 1.00 line progressively darker.
   */
  const GRADING_PLOT = Object.freeze({
    left: 84.62,
    right: 495.62,
    top: 311.12,
    bottom: 389.0,
  });
  const GRADING_MINOR_GRID = Object.freeze([0.94, 0.94, 0.94]);
  const GRADING_DECADE_GRID = Object.freeze([0.86, 0.86, 0.86]);
  const GRADING_UNIT_GRID = Object.freeze([0.75, 0.75, 0.75]);

  /**
   * The reference's chart text is Calibri; the overlay draws Helvetica, whose
   * glyphs stand about a tenth taller at the same point size. Sizes measured
   * from the reference are scaled by this so the rendered text matches it.
   */
  const CHART_FONT_SCALE = 0.9;

  /** Shear-chart font sizes, measured from the reference, as drawn in Helvetica. */
  const CHART_FONTS = Object.freeze({
    axisValue: 8.544 * CHART_FONT_SCALE,
    axisTitle: 9.456 * CHART_FONT_SCALE,
    note: 8.568 * CHART_FONT_SCALE,
  });

  /** Font sizes the reference chart uses, in points, as drawn in Helvetica. */
  const GRADING_FONTS = Object.freeze({
    title: 13.32 * CHART_FONT_SCALE,
    axisValue: 8.544 * CHART_FONT_SCALE,
    axisTitle: 9.48 * CHART_FONT_SCALE,
    legend: 8.568 * CHART_FONT_SCALE,
  });

  /** Horizontal position of one sieve size on the logarithmic axis. */
  function gradingX(value) {
    const span = GRADING_PLOT.right - GRADING_PLOT.left;
    return GRADING_PLOT.left + ((Math.log10(Math.max(value, 0.01)) + 2) / 3) * span;
  }

  function drawGradingGrid(page, fonts, pdfLib) {
    const height = GRADING_PLOT.bottom - GRADING_PLOT.top;
    // Excel rules this axis every 4%, labelling every 20%.
    for (let value = 0; value <= 100; value += 4) {
      const top = GRADING_PLOT.bottom - (value / 100) * height;
      line(page, GRADING_PLOT.left, top, GRADING_PLOT.right, top, pdfLib, GRADING_MINOR_GRID, 0.5);
    }
    for (let value = 0; value <= 100; value += 20) {
      const top = GRADING_PLOT.bottom - (value / 100) * height;
      // The reference sets each value's baseline 2.88pt below its gridline.
      chartText(page, String(value), 60, top + 2.88 - GRADING_FONTS.axisValue,
        GRADING_FONTS.axisValue, fonts, pdfLib, { width: 18, align: "right" });
    }

    for (let exponent = -2; exponent <= 1; exponent += 1) {
      const decade = 10 ** exponent;
      if (exponent < 1) {
        for (let step = 2; step <= 9; step += 1) {
          const x = gradingX(decade * step);
          line(page, x, GRADING_PLOT.top, x, GRADING_PLOT.bottom, pdfLib,
            GRADING_MINOR_GRID, 0.5);
        }
      }
      const x = gradingX(decade);
      const shade = decade === 1 ? GRADING_UNIT_GRID : GRADING_DECADE_GRID;
      line(page, x, GRADING_PLOT.top, x, GRADING_PLOT.bottom, pdfLib, shade, 0.5);
      chartText(page, decade.toFixed(2), x - 12, 403 - GRADING_FONTS.axisValue,
        GRADING_FONTS.axisValue, fonts, pdfLib, { width: 24, align: "center" });
    }
  }

  function drawGradingChart(page, chart, fonts, pdfLib) {
    drawChartFrame(page, chart, fonts, pdfLib);
    chartText(page, "Grading Chart", chart.x, 296.1 - GRADING_FONTS.title,
      GRADING_FONTS.title, fonts, pdfLib, { width: chart.width, align: "center" });
    drawGradingGrid(page, fonts, pdfLib);

    const height = GRADING_PLOT.bottom - GRADING_PLOT.top;
    const toPoint = (row, field) => ({
      x: gradingX(numeric(row.sieveSizeMm)),
      top: GRADING_PLOT.bottom - (numeric(Reflect.get(row, field)) / 100) * height,
    });
    const series = [
      ["cumulativePassingPercent", GRADING_SERIES_STYLES.cumulativePassingPercent],
      ["lowerLimit", GRADING_SERIES_STYLES.lowerLimit],
      ["upperLimit", GRADING_SERIES_STYLES.upperLimit],
    ];
    for (const [field, style] of series) {
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
            style.color,
            1.6,
            style.dashArray,
          );
        }
        circle(page, point.x, point.top, pdfLib, style.color, 2.2);
      });
    }

    const axisTitleSize = 9.456 * CHART_FONT_SCALE;
    chartText(page, "Cumulative % passing", 58.7, 400 - axisTitleSize, axisTitleSize,
      fonts, pdfLib, { rotate: 90 });
    chartText(page, "Sieve Size (mm)", 260.4, 417.1 - GRADING_FONTS.axisTitle,
      GRADING_FONTS.axisTitle, fonts, pdfLib);
    const legends = [
      ["Grading Curve", 185.9, GRADING_SERIES_STYLES.cumulativePassingPercent],
      ["Lower Limit", 276.4, GRADING_SERIES_STYLES.lowerLimit],
      ["Upper Limit", 358.0, GRADING_SERIES_STYLES.upperLimit],
    ];
    for (const [label, x, style] of legends) {
      line(page, x - 26, 439, x - 6, 439, pdfLib, style.color, 1.5, style.dashArray);
      circle(page, x - 16, 439, pdfLib, style.color, 2);
      chartText(page, label, x, 442 - GRADING_FONTS.legend, GRADING_FONTS.legend,
        fonts, pdfLib);
    }
  }

  function drawAxes(page, plot, fonts, pdfLib, xMax) {
    const grid = [0.87, 0.87, 0.87];
    for (let value = 0; value <= 140; value += 20) {
      const top = plot.bottom - (value / 140) * (plot.bottom - plot.top);
      line(page, plot.left, top, plot.right, top, pdfLib, grid, 0.5);
      chartText(page, String(value), plot.left - 22, top - 4, CHART_FONTS.axisValue, fonts, pdfLib, {
        width: 18,
        align: "right",
      });
    }
    const steps = xMax === 150 ? [0, 50, 100, 150] : [0, 2, 4, 6];
    for (const value of steps) {
      const x = plot.left + (value / xMax) * (plot.right - plot.left);
      line(page, x, plot.top, x, plot.bottom, pdfLib, grid, 0.5);
      chartText(page, xMax === 6 ? value.toFixed(1) : String(value), x - 8, plot.bottom + 5,
        CHART_FONTS.axisValue, fonts, pdfLib);
    }
  }

  function drawNormalShearChart(page, chart, fonts, pdfLib) {
    drawChartFrame(page, chart, fonts, pdfLib);
    const plot = { left: 84.88, right: 248.25, top: 313.25, bottom: 407.5 };
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
    chartText(page, `y = ${slope.toFixed(4)}x`, 186.5, 329.25, CHART_FONTS.note, fonts, pdfLib);
    chartText(page, "Max. Shear Stress (kPa)", 52.88, 404.5, CHART_FONTS.axisTitle, fonts, pdfLib, {
      rotate: 90,
    });
    chartText(page, "Normal Stress (kPa)", 127.57, 426.5, CHART_FONTS.axisTitle, fonts, pdfLib);
    circle(page, last.x, last.top, pdfLib, [0.31, 0.55, 0.78], 2.4);
  }

  function drawDisplacementShearChart(page, chart, fonts, pdfLib) {
    drawChartFrame(page, chart, fonts, pdfLib);
    const plot = { left: 330.0, right: 495.12, top: 313.25, bottom: 407.5 };
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
    chartText(page, "Max. Shear Stress (kPa)", 303, 404.5, CHART_FONTS.axisTitle, fonts, pdfLib, {
      rotate: 90,
    });
    chartText(page, "Horizontal Displacement (mm)", 348.06, 426.5, CHART_FONTS.axisTitle,
      fonts, pdfLib);
  }

  async function drawImage(outputDocument, page, operation) {
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
        // Without replacement artwork the reference page keeps its own, so the
        // approved signatures survive workbooks parsed without images.
        if (!image.asset?.bytes) continue;
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
    let overlayReportCount = 0;
    let valueMaskCount = 0;
    let maxValueMaskHeight = 0;
    let chartCount = 0;
    let imageOverlayCount = 0;

    // Every report is overlaid from its own mapped values, including one whose
    // data happens to equal the reference sample's. Copying the reference
    // pages untouched for that case would leave one report in the document
    // carrying the reference's values and typography rather than the uploaded
    // workbook's -- the exported report must never be the static asset.
    for (const report of reports) {
      const pages = await outputDocument.copyPages(templateDocument, [0, 1, 2, 3, 4]);
      pages.forEach((page) => outputDocument.addPage(page));
      overlayReportCount += 1;
      const plan = buildOverlayPlan(report);
      for (const page of plan) {
        const valueMasks = page.whiteouts.filter((mask) => mask.kind === "value-mask");
        valueMaskCount += valueMasks.length;
        for (const mask of valueMasks) {
          maxValueMaskHeight = Math.max(maxValueMaskHeight, mask.height);
        }
        chartCount += (page.chart ? 1 : 0) + (page.charts?.length ?? 0);
        imageOverlayCount += page.images.length;
      }
      await applyOverlayPlan(outputDocument, pages, plan, fonts, pdfLib);
    }
    const bytes = await outputDocument.save();
    globalThis.docuAlignLogger?.logInfo?.("PDF template rendering completed", {
      feature: "PdfTemplate",
      function: "createRakReportPdf",
      operation: "pdf.copyAndOverlay",
      category: "LocalPdfGeneration",
      templateSource: options.templateBytes ? "injected" : "bundled",
      reportCount: reports.length,
      copiedPageCount: reports.length * 5,
      overlayReportCount,
      valueMaskCount,
      maxValueMaskHeight,
      chartCount,
      imageOverlayCount,
      outputBytes: bytes.length,
    });
    return new Blob([bytes], { type: "application/pdf" });
  }

  globalThis.docuAlignRakReportPdf = Object.freeze({
    GRADING_SERIES_STYLES,
    buildOverlayPlan,
    createRakReportPdf,
  });
})();
