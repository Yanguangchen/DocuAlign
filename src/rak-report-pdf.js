/**
 * @file rak-report-pdf.js
 * @description Deterministic portrait renderer for the five-page RAK report
 * layout represented by SampleOutput.pdf. Multiple worksheet report groups are
 * concatenated into one PDF while retaining five pages per report.
 */
(() => {
  const PDF_OPTIONS = Object.freeze({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
    compress: true,
  });
  const TERMS = Object.freeze([
    "1. The results reported herein have been performed in accordance with the terms of accreditation under the Singapore Accreditation Council.",
    "2. The report is prepared on the basis of the required experiments and the particular materials presented for testing to RAK Materials Consultants Pte Ltd (RAK). RAK assumes no liability for differences in the quality or other features of presented products under circumstances that are not controlled by RAK. This report is not a recommendation for the product or material being tested or endorsed. The test results and conclusions relate to the sample tested as described herein.",
    "3. RAK agrees to use a reasonable degree of diligence in the way tests, inspections or services are performed, but no warranties are given and none can be implied directly or indirectly in relation to the test results, services or facilities of RAK. RAK shall not be responsible for any unique, consequential or collateral harm.",
    "4. The report shall not be reproduced except in full unless written approval has been given by RAK.",
    "5. No other third party can receive the Report through RAK unless it is stipulated in the RAK Request Form or has obtained written instructions from the authority to authorize RAK to do so.",
    "6. The report shall not be used in advertising without RAK's written permission.",
  ]);

  function resolvePdfConstructor(pdfApi) {
    if (pdfApi === null) return null;
    return pdfApi?.jsPDF ?? globalThis.jspdf?.jsPDF ?? null;
  }

  function resolveAutoTable(pdfApi, document) {
    if (typeof pdfApi?.autoTable === "function") return pdfApi.autoTable;
    if (typeof globalThis.autoTable === "function") return globalThis.autoTable;
    if (typeof document.autoTable === "function") {
      return (pdfDocument, options) => pdfDocument.autoTable(options);
    }
    return null;
  }

  function setTextStyle(document, size = 9, bold = false, color = [28, 47, 54]) {
    document.setFont("helvetica", bold ? "bold" : "normal");
    document.setFontSize(size);
    document.setTextColor(...color);
  }

  function writeWrapped(document, value, x, y, width, lineHeight = 3.5) {
    const content = String(value ?? "");
    const lines = typeof document.splitTextToSize === "function"
      ? document.splitTextToSize(content, width)
      : [content];
    document.text(lines, x, y);
    return y + lines.length * lineHeight;
  }

  function drawReportHeader(document, report, pageNumber) {
    setTextStyle(document, 8, true);
    document.text(`JOB REF: ${report.jobRef}`, 12, 11);
    document.text(`Page ${pageNumber} of 5`, 176, 11);
    document.setDrawColor(39, 100, 116);
    document.setLineWidth(0.35);
    document.line(12, 14, 198, 14);
  }

  function drawSectionTitle(document, value, y) {
    setTextStyle(document, 10, true, [18, 77, 94]);
    document.text(value, 12, y);
  }

  function drawCoverPage(document, report) {
    const cover = report.cover;
    setTextStyle(document, 18, true, [18, 77, 94]);
    document.text("TEST REPORT", 142, 18);
    setTextStyle(document, 8, true);
    document.text("R.A.K Materials Consultants Pte Ltd", 130, 27);
    setTextStyle(document, 7);
    document.text("Block 2019 Bukit Batok Street 23", 130, 32);
    document.text("#01-268 & #03-268 Singapore 659524", 130, 36);
    document.text("Tel: +65 65615366", 130, 40);
    document.text("Email: rakmat@singnet.com.sg", 130, 44);
    document.text("Website: www.rakmat.com.sg", 130, 48);

    const rows = [
      ["Client Name", cover.clientName],
      ["Address", cover.addressLines.join("\n")],
      ["Tel No/Fax No", cover.telephoneFax],
      ["Email", cover.email],
      ["Attention to", cover.attentionTo],
      ["Project Code/Title", cover.projectTitle],
    ];
    let y = 18;
    for (const [label, value] of rows) {
      setTextStyle(document, 8, true);
      document.text(`${label} :`, 12, y);
      setTextStyle(document, 8);
      y = writeWrapped(document, value, 47, y, 77, 3.5);
      y += 1.5;
    }

    setTextStyle(document, 8, true);
    document.text("Test Method :", 12, y);
    setTextStyle(document, 7.5);
    for (const method of cover.testMethods) {
      y = writeWrapped(document, method, 47, y, 77, 3.2);
    }
    y += 2;
    setTextStyle(document, 8, true);
    document.text("Test Standards :", 12, y);
    setTextStyle(document, 7.2);
    for (const standard of cover.testStandards) {
      y = writeWrapped(document, standard, 47, y, 77, 3.1);
    }

    const details = [
      ["Job Ref.", cover.jobRef],
      ["Vessel Name", cover.vesselName],
      ["VOY No.", cover.voyageNumber],
      ["Client Ref./Sample ID", cover.sampleId],
      ["Sampling Date", cover.samplingDate],
      ["Date Received", cover.dateReceived],
      ["Date of Report", cover.dateOfReport],
      ["Total Pages", cover.totalPages],
      ["Remarks", cover.remarks],
    ];
    y += 3;
    for (const [label, value] of details) {
      setTextStyle(document, 7.8, true);
      document.text(`${label} :`, 12, y);
      setTextStyle(document, 7.8);
      y = writeWrapped(document, value, 47, y, 77, 3.3);
      y += 1;
    }

    setTextStyle(document, 8.5, true, [18, 77, 94]);
    document.text("Terms & Conditions", 12, 204);
    let termsY = 210;
    setTextStyle(document, 6.4);
    for (const term of TERMS) {
      termsY = writeWrapped(document, term, 12, termsY, 186, 2.8) + 1;
    }
  }

  function numeric(value) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function drawPolyline(document, points, color) {
    document.setDrawColor(...color);
    document.setLineWidth(0.45);
    for (let index = 1; index < points.length; index += 1) {
      const previous = points.at(index - 1);
      const current = points.at(index);
      document.line(previous.x, previous.y, current.x, current.y);
    }
  }

  function drawChartFrame(document, x, y, width, height, title) {
    setTextStyle(document, 7.5, true);
    document.text(title, x, y - 2);
    document.setDrawColor(130, 149, 157);
    document.setLineWidth(0.2);
    document.rect(x, y, width, height);
    for (let step = 1; step < 5; step += 1) {
      const gridY = y + (height * step) / 5;
      document.setDrawColor(220, 228, 231);
      document.line(x, gridY, x + width, gridY);
    }
  }

  function drawGradingChart(document, rows) {
    const x = 14;
    const y = 93;
    const width = 114;
    const height = 58;
    drawChartFrame(document, x, y, width, height, "Grading Chart");
    const toX = (value) => x + ((Math.log10(Math.max(value, 0.01)) + 2) / 3) * width;
    const toY = (value) => y + height - (value / 100) * height;
    const pointsFor = (field) => rows
      .map((row) => ({
        x: toX(numeric(row.sieveSizeMm)),
        y: toY(numeric(Reflect.get(row, field))),
      }))
      .sort((left, right) => left.x - right.x);
    drawPolyline(document, pointsFor("cumulativePassingPercent"), [18, 97, 128]);
    drawPolyline(document, pointsFor("lowerLimit"), [215, 118, 54]);
    drawPolyline(document, pointsFor("upperLimit"), [72, 137, 89]);
    setTextStyle(document, 6.5);
    document.text("Sieve Size (mm, log scale)", 47, 156);
    document.text("Cumulative % passing", 14, 90);
  }

  function renderPageTwo(document, report, table) {
    drawReportHeader(document, report, 2);
    drawSectionTitle(
      document,
      "1. Determination of Particle Size Distribution (BS 812-103.1:1985)",
      21,
    );
    table(document, {
      head: [[
        "Sieve Size (mm)",
        "Cumulative % Passing",
        "Lower Limit (JTC Requirement)",
        "Upper Limit (JTC Requirement)",
      ]],
      body: report.psd.rows.map((row) => [
        row.sieveSizeMm,
        row.cumulativePassingPercent,
        row.lowerLimit,
        row.upperLimit,
      ]),
      startY: 25,
      margin: { left: 12, right: 12 },
      theme: "grid",
      pageBreak: "avoid",
      styles: { fontSize: 7, cellPadding: 1.2, textColor: [25, 45, 52] },
      headStyles: { fillColor: [18, 97, 128], textColor: 255 },
    });
    drawGradingChart(document, report.psd.rows);
    setTextStyle(document, 7.3, true);
    document.text("Remarks:", 134, 94);
    setTextStyle(document, 7.1);
    let remarksY = 99;
    for (const remark of report.psd.remarks) {
      remarksY = writeWrapped(document, remark, 134, remarksY, 64, 3.2) + 1;
    }

    drawSectionTitle(
      document,
      "2. Silt Content (BS 812-103.1:1985) and Coral / Shell Content (SANS 5840:2008)",
      169,
    );
    setTextStyle(document, 8);
    document.text(
      `Silt Content (%) from passing 0.063mm sieve    ${report.siltCoral.siltPercent}`,
      16,
      178,
    );
    document.text(
      `Coral / Shell Content (%)                             ${report.siltCoral.coralShellPercent}`,
      16,
      185,
    );
    document.text(
      `Total (%)                                                     ${report.siltCoral.totalPercent}`,
      16,
      192,
    );
    document.text(`JTC Requirement: ${report.siltCoral.requirement}`, 118, 192);

    drawSectionTitle(
      document,
      "3. Determination of Moisture Content (BS 1377-2:1990 Clause 3(Part 3.2))",
      208,
    );
    setTextStyle(document, 8);
    document.text(`Moisture Content (%)    ${report.moisture.percent}`, 16, 217);
    document.text(`Remarks: ${report.moisture.remark}`, 16, 225);
  }

  function drawShearCharts(document, rows) {
    const chartDefinitions = [
      {
        x: 12,
        title: "Normal Stress vs Max. Shear Stress",
        xField: "normalStressKpa",
        xMax: 150,
      },
      {
        x: 108,
        title: "Horizontal Displacement vs Max. Shear Stress",
        xField: "horizontalDisplacementMm",
        xMax: 6,
      },
    ];
    for (const definition of chartDefinitions) {
      const y = 151;
      const width = 88;
      const height = 60;
      drawChartFrame(document, definition.x, y, width, height, definition.title);
      const points = rows.map((row) => ({
        x: definition.x + (numeric(Reflect.get(row, definition.xField)) / definition.xMax) * width,
        y: y + height - (numeric(row.maxShearStressKpa) / 140) * height,
      }));
      drawPolyline(document, points, [18, 97, 128]);
      document.setFillColor(18, 97, 128);
      for (const point of points) document.circle(point.x, point.y, 0.8, "F");
    }
  }

  function renderPageThree(document, report, table) {
    drawReportHeader(document, report, 3);
    drawSectionTitle(
      document,
      "4. Shear Strength by Direct Shear (Small Shearbox Apparatus) (BS 1377-7:1990 Clause 4 (Part 4.5.4))",
      21,
    );
    setTextStyle(document, 7.4);
    const summary = report.directShear;
    const left = [
      `Maximum Dry Density, Mg/m3: ${summary.maximumDryDensity}`,
      `Minimum Dry Density, Mg/m3: ${summary.minimumDryDensity}`,
      `% Retained on 2.0mm Sieve: ${summary.retainedOn2mmPercent}`,
      `Shearing Rate (mm/min): ${summary.shearingRate}`,
    ];
    const right = [
      summary.condition,
      `Initial Bulk Density (Mg/m3): ${summary.initialBulkDensity}`,
      `Initial Dry Density (Mg/m3): ${summary.initialDryDensity}`,
      `Angle of Shearing Resistance: ${summary.angle} (${summary.requirement})`,
    ];
    left.forEach((value, index) => document.text(value, 16, 31 + index * 6));
    right.forEach((value, index) => document.text(value, 108, 31 + index * 6));
    table(document, {
      body: [
        ["Normal Stress (kPa)", ...summary.rows.map((row) => row.normalStressKpa)],
        ["Max. Shear Stress (kPa)", ...summary.rows.map((row) => row.maxShearStressKpa)],
        [
          "Horizontal displacement (mm)",
          ...summary.rows.map((row) => row.horizontalDisplacementMm),
        ],
      ],
      startY: 59,
      margin: { left: 16, right: 16 },
      theme: "grid",
      pageBreak: "avoid",
      styles: { fontSize: 7.2, cellPadding: 1.4 },
      columnStyles: { 0: { fontStyle: "bold", cellWidth: 54 } },
    });
    drawShearCharts(document, summary.rows);
    drawSectionTitle(
      document,
      "5. Determination of Organic Matter Content (BS 1377-3: 2018, Section 4)",
      228,
    );
    setTextStyle(document, 8);
    document.text(`Organic Matter Content (%)    ${report.organicMatter.percent}`, 16, 238);
  }

  function imageFormat(image) {
    return image.mimeType === "image/png" ? "PNG" : "JPEG";
  }

  function addWorkbookImage(document, image, x, y, width, height) {
    if (!image) return;
    document.addImage(image.bytes, imageFormat(image), x, y, width, height);
  }

  function renderPageFour(document, report, table) {
    drawReportHeader(document, report, 4);
    drawSectionTitle(
      document,
      "6. 12 Metallic Analysis (EPA 3051A & EPA 6010C)",
      21,
    );
    table(document, {
      head: [["Element", "Results (ppm)", "Upper Limit Concentration (ppm)"]],
      body: report.metals.rows.map((row) => [
        row.element,
        row.resultPpm,
        row.upperLimitPpm,
      ]),
      startY: 25,
      margin: { left: 16, right: 16 },
      theme: "grid",
      pageBreak: "avoid",
      styles: { fontSize: 7.2, cellPadding: 1.15 },
      headStyles: { fillColor: [18, 97, 128], textColor: 255 },
    });
    setTextStyle(document, 7.2, true);
    document.text("Remarks:", 16, 159);
    setTextStyle(document, 6.9);
    let remarkY = 165;
    for (const remark of report.metals.remarks) {
      remarkY = writeWrapped(document, `• ${remark}`, 18, remarkY, 178, 3.2) + 1;
    }

    setTextStyle(document, 8, true);
    document.text("PREPARED BY", 28, 213);
    document.text("AUTHORISED BY", 126, 213);
    addWorkbookImage(document, report.assets.preparedSignature, 27, 216, 45, 18);
    addWorkbookImage(document, report.assets.authorisedSignature, 125, 216, 45, 18);
    document.line(25, 239, 82, 239);
    document.line(123, 239, 180, 239);
    setTextStyle(document, 8);
    document.text(report.signoff.preparedByName, 28, 245);
    document.text(report.signoff.preparedByTitle, 28, 251);
    document.text(report.signoff.authorisedByName, 126, 245);
    document.text(report.signoff.authorisedByTitle, 126, 251);
  }

  function renderPageFive(document, report) {
    drawReportHeader(document, report, 5);
    drawSectionTitle(document, report.appendix.title, 23);
    setTextStyle(document, 8);
    document.text(report.appendix.label, 12, 31);
    const positions = [
      { x: 16, y: 37, width: 178, height: 104 },
      { x: 16, y: 151, width: 178, height: 104 },
    ];
    report.appendix.photos.forEach((photo, index) => {
      const position = positions.at(index);
      if (position) {
        addWorkbookImage(
          document,
          photo,
          position.x,
          position.y,
          position.width,
          position.height,
        );
      }
    });
  }

  function renderReport(document, report, table, isFirstReport) {
    if (!isFirstReport) document.addPage();
    drawCoverPage(document, report);
    document.addPage();
    renderPageTwo(document, report, table);
    document.addPage();
    renderPageThree(document, report, table);
    document.addPage();
    renderPageFour(document, report, table);
    document.addPage();
    renderPageFive(document, report);
  }

  /**
   * Generate one PDF containing five portrait pages for every mapped report.
   * @param {Array<object>} reports - Semantic report models.
   * @param {{jsPDF?: Function, autoTable?: Function}} [pdfApi] - Injectable APIs.
   * @returns {Blob} Generated PDF.
   */
  function createRakReportPdf(reports, pdfApi) {
    if (!Array.isArray(reports) || reports.length === 0) {
      throw new Error("PDF export requires at least one mapped report.");
    }
    const PdfConstructor = resolvePdfConstructor(pdfApi);
    if (typeof PdfConstructor !== "function") {
      throw new Error("The browser PDF generator is unavailable.");
    }
    const document = new PdfConstructor(PDF_OPTIONS);
    const table = resolveAutoTable(pdfApi, document);
    if (typeof table !== "function") {
      throw new Error("The PDF table renderer is unavailable.");
    }
    reports.forEach((report, index) => renderReport(document, report, table, index === 0));
    return document.output("blob");
  }

  globalThis.docuAlignRakReportPdf = Object.freeze({
    createRakReportPdf,
  });
})();
