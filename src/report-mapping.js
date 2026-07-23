/**
 * @file report-mapping.js
 * @description Converts repeated CV/TR/DS/SB worksheet groups into the
 * semantic five-page RAK report model defined by the sample workbook and PDF.
 * This classic-script module is shared by direct-file and Vite execution.
 */
(() => {
  const ROLE_FIELDS = Object.freeze({
    CV1: "coverSheetName",
    TR1: "reportSheetName",
    DS1: "dataSheetName",
    SB1: "shearSheetName",
  });
  const STRESS_COLUMNS = Object.freeze(["M", "P", "V", "AB"]);
  const SIGNOFF = Object.freeze({
    preparedByName: "Jocelyn Lee Jia Min",
    preparedByTitle: "Lab Engineer",
    authorisedByName: "Ken Lee",
    authorisedByTitle: "Managing Director",
  });

  function sheetIdentity(sheetName) {
    let normalized = sheetName.trim();
    while (normalized.includes("  ")) normalized = normalized.replaceAll("  ", " ");
    for (const role of Object.keys(ROLE_FIELDS)) {
      if (normalized === role) return { role, index: 1 };
      const prefix = `${role} (`;
      if (!normalized.startsWith(prefix) || !normalized.endsWith(")")) continue;
      const indexText = normalized.slice(prefix.length, -1);
      const index = Number(indexText);
      if (Number.isInteger(index) && index >= 2 && String(index) === indexText) {
        return { role, index };
      }
    }
    return null;
  }

  /**
   * Identify complete report groups while normalizing the workbook's
   * inconsistent spaces and base-group naming convention.
   * @param {string[]} sheetNames - Workbook tab names.
   * @returns {Array<object>} Complete CV/TR groups in numeric order.
   */
  function discoverReportGroups(sheetNames = []) {
    const groups = new Map();
    for (const sheetName of sheetNames) {
      const identity = sheetIdentity(sheetName);
      if (!identity) continue;
      const { index, role } = identity;
      if (!groups.has(index)) groups.set(index, { index });
      const field = Reflect.get(ROLE_FIELDS, role);
      Reflect.set(groups.get(index), field, sheetName);
    }

    return Array.from(groups.values())
      .filter((group) => group.coverSheetName && group.reportSheetName)
      .sort((left, right) => left.index - right.index);
  }

  function text(sheet, address) {
    const value = Reflect.get(sheet?.cells ?? {}, address);
    return value === null || value === undefined ? "" : String(value).trim();
  }

  function range(sheet, column, startRow, endRow) {
    const values = [];
    for (let row = startRow; row <= endRow; row += 1) {
      values.push(text(sheet, `${column}${row}`));
    }
    return values;
  }

  function pairedRows(sheet, numberColumn, valueColumn, startRow, endRow) {
    const values = [];
    for (let row = startRow; row <= endRow; row += 1) {
      const number = text(sheet, `${numberColumn}${row}`);
      const value = text(sheet, `${valueColumn}${row}`);
      values.push([number, value].filter(Boolean).join(" "));
    }
    return values;
  }

  function findImage(sheet, predicate) {
    return (sheet.images ?? []).find(predicate) ?? null;
  }

  function appendixPhotos(sheet) {
    return (sheet.images ?? [])
      .filter((image) => image.row >= 147 && image.column === 5)
      .sort((left, right) => left.row - right.row)
      .slice(0, 2);
  }

  function buildPsdRows(reportSheet) {
    const sieveSizes = range(reportSheet, "A", 8, 14);
    const passing = range(reportSheet, "I", 8, 14);
    const lower = range(reportSheet, "Q", 8, 14);
    const upper = range(reportSheet, "Z", 8, 14);
    return sieveSizes.map((sieveSizeMm, index) => ({
      sieveSizeMm,
      cumulativePassingPercent: passing.at(index),
      lowerLimit: lower.at(index),
      upperLimit: upper.at(index),
    }));
  }

  function buildShearRows(reportSheet) {
    return STRESS_COLUMNS.map((column) => ({
      normalStressKpa: text(reportSheet, `${column}55`),
      maxShearStressKpa: text(reportSheet, `${column}56`),
      horizontalDisplacementMm: text(reportSheet, `${column}57`),
    }));
  }

  function buildMetalRows(reportSheet) {
    const elements = range(reportSheet, "A", 95, 106);
    const results = range(reportSheet, "L", 95, 106);
    const limits = range(reportSheet, "X", 95, 106);
    return elements.map((element, index) => ({
      element,
      resultPpm: results.at(index),
      upperLimitPpm: limits.at(index),
    }));
  }

  function buildReport(group, sheetsByName, sourceName) {
    const coverSheet = sheetsByName.get(group.coverSheetName);
    const reportSheet = sheetsByName.get(group.reportSheetName);
    const jobRef = text(coverSheet, "K28") || text(reportSheet, "AE2");
    const preparedSignature = findImage(
      reportSheet,
      (image) => image.row >= 129 && image.row <= 131 && image.column <= 5,
    );
    const authorisedSignature = findImage(
      reportSheet,
      (image) => image.row >= 129 && image.row <= 131 && image.column >= 20,
    );

    return {
      schemaVersion: 2,
      groupIndex: group.index,
      pageCount: 5,
      sourceName,
      sourceSheets: { ...group },
      jobRef,
      cover: {
        clientName: text(coverSheet, "K5"),
        addressLines: [text(coverSheet, "K6"), text(coverSheet, "K7")],
        telephoneFax: text(coverSheet, "K8"),
        email: text(coverSheet, "K9"),
        attentionTo: text(coverSheet, "K10"),
        projectTitle: text(coverSheet, "K12"),
        testMethods: pairedRows(coverSheet, "K", "L", 14, 19),
        testStandards: pairedRows(coverSheet, "K", "L", 21, 26),
        jobRef,
        vesselName: text(coverSheet, "K29"),
        voyageNumber: text(coverSheet, "K30"),
        sampleId: text(coverSheet, "K31"),
        samplingDate: text(coverSheet, "K32"),
        dateReceived: text(coverSheet, "K33"),
        dateOfReport: text(coverSheet, "K34"),
        totalPages: text(coverSheet, "K36"),
        remarks: text(coverSheet, "K37"),
      },
      psd: {
        rows: buildPsdRows(reportSheet),
        remarks: [text(reportSheet, "E24"), text(reportSheet, "E25")],
      },
      siltCoral: {
        siltPercent: text(reportSheet, "R28"),
        coralShellPercent: text(reportSheet, "R29"),
        totalPercent: text(reportSheet, "R30"),
        requirement: text(reportSheet, "AA30"),
      },
      moisture: {
        percent: text(reportSheet, "R33"),
        remark: text(reportSheet, "E34"),
      },
      directShear: {
        maximumDryDensity: text(reportSheet, "U46"),
        minimumDryDensity: text(reportSheet, "U47"),
        retainedOn2mmPercent: text(reportSheet, "U48"),
        shearingRate: text(reportSheet, "U49"),
        condition: text(reportSheet, "A50"),
        initialBulkDensity: text(reportSheet, "U50"),
        initialDryDensity: text(reportSheet, "U51"),
        angle: text(reportSheet, "A53"),
        requirement: text(reportSheet, "P53"),
        rows: buildShearRows(reportSheet),
      },
      organicMatter: {
        percent: text(reportSheet, "R71"),
      },
      metals: {
        rows: buildMetalRows(reportSheet),
        remarks: [
          text(reportSheet, "E108"),
          text(reportSheet, "E109"),
          text(reportSheet, "E110"),
        ],
      },
      signoff: { ...SIGNOFF },
      assets: {
        preparedSignature,
        authorisedSignature,
      },
      appendix: {
        title: text(reportSheet, "A144") || "APPENDIX",
        label: text(reportSheet, "A146") || "Photographs of sample received:",
        photos: appendixPhotos(reportSheet),
      },
    };
  }

  /**
   * Map every complete worksheet group in one parsed workbook.
   * @param {{sourceName?: string, sheets?: Array<object>}} workbookData
   * @returns {Array<object>} One semantic five-page model per report group.
   */
  function buildMappedReports(workbookData = {}) {
    const sheets = Array.isArray(workbookData.sheets) ? workbookData.sheets : [];
    const groups = discoverReportGroups(sheets.map((sheet) => sheet.name));
    if (groups.length === 0) {
      throw new Error("The workbook does not contain any complete report groups.");
    }
    const sheetsByName = new Map(sheets.map((sheet) => [sheet.name, sheet]));
    return groups.map((group) =>
      buildReport(group, sheetsByName, workbookData.sourceName ?? "workbook"));
  }

  globalThis.docuAlignReportMapping = Object.freeze({
    buildMappedReports,
    discoverReportGroups,
  });
})();
