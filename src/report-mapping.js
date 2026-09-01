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

  /** The column every cover value sits in, on its own label's row. */
  const COVER_VALUE_COLUMN = "K";
  const CELL_ADDRESS = /^([A-Z]+)(\d+)$/;

  /** A cover label reduced to what identifies it, ignoring spacing and stops. */
  function labelKey(value) {
    return String(value ?? "").toLowerCase().replaceAll(/[^a-z0-9]+/g, "");
  }

  /** A column letter as its 1-based number, so `A` < `C` < `K` can be compared. */
  function columnNumber(column) {
    let number = 0;
    for (const letter of column) number = (number * 26) + (letter.charCodeAt(0) - 64);
    return number;
  }

  /**
   * Every row of the cover sheet that carries a label, keyed by that label.
   *
   * The cover writes each field as a label in column C, a colon, and the value
   * in column K, so only the columns LEFT of the value column are labels.
   * @param {object} sheet - Cover sheet.
   * @returns {Map<string, number[]>} Label key to the rows carrying it.
   */
  function coverLabelRows(sheet) {
    const rows = new Map();
    const valueColumn = columnNumber(COVER_VALUE_COLUMN);
    for (const [address, value] of Object.entries(sheet?.cells ?? {})) {
      const cell = address.match(CELL_ADDRESS);
      if (!cell || columnNumber(cell[1]) >= valueColumn) continue;
      const key = labelKey(value);
      if (!key) continue;
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push(Number(cell[2]));
    }
    return rows;
  }

  /**
   * Read the cover by its own labels rather than by the sample's rows.
   *
   * Every cover field used to be a fixed cell address measured from
   * `SampleInput.xlsx`. Those addresses are that workbook's, not the form's: a
   * client workbook listing two more test standards pushes the whole identity
   * block down, and every field from `Job Ref.` on then reads the row above its
   * own label -- the vessel name printed as the sample id, the sampling date as
   * the date received, on a signed report with nothing to show for it. The same
   * lesson as the pictures in AGENTS.md 2a: an absolute row is never the
   * primary selector.
   *
   * The label is what identifies a field, so each value is read from the row
   * its label sits on, and the sample's row is kept only as the fallback for a
   * sheet that does not carry that label at all.
   * @param {object} sheet - Cover sheet.
   * @returns {{row: Function, value: Function}} Row and value readers.
   */
  function coverReader(sheet) {
    const labelRows = coverLabelRows(sheet);
    const row = (label, sampleRow) => {
      const candidates = labelRows.get(labelKey(label));
      if (!candidates || candidates.length === 0) return sampleRow;
      // A word repeated elsewhere on the sheet resolves to the occurrence
      // nearest the row the sample keeps the field on, so a stray match
      // cannot move a field to the other end of the page.
      return candidates.reduce((best, candidate) =>
        (Math.abs(candidate - sampleRow) < Math.abs(best - sampleRow) ? candidate : best));
    };
    return {
      row,
      value: (label, sampleRow) =>
        text(sheet, `${COVER_VALUE_COLUMN}${row(label, sampleRow)}`),
    };
  }

  /**
   * The appendix photographs on one report sheet.
   *
   * The strict anchor is the sample workbook's own: row 147 or below, column 5
   * exactly. It is tried first so any workbook laid out like the sample keeps
   * behaving exactly as before.
   *
   * Real client workbooks do not share those coordinates. The appendix sits
   * wherever that report's rows happen to end, so no absolute row or column
   * survives contact with a second workbook -- and when the anchor misses,
   * nothing is extracted, `rak-report-pdf.js` skips the whiteout for a picture
   * with no bytes, and the REFERENCE SAMPLE's photographs stay on the page. The
   * report then shows another vessel's sample bag with no error anywhere.
   *
   * The fallback is therefore structural rather than positional. Two facts hold
   * across layouts: the appendix is the last thing on the sheet, and the
   * letterhead is the only picture repeated on it. So drop the repeated marks
   * and the two signatures, and the photographs are what remain at the bottom.
   * Repetition is detected by `bytes` identity -- the reader inflates each
   * media part once and hands every anchor the same array (see
   * `readSheetImages`), so the letterhead's four anchors share one object.
   * @param {{images?: Array<object>}} sheet - Report sheet.
   * @param {Array<object>} signatures - Pictures already claimed as signatures.
   * @returns {Array<object>} Up to two photographs, in row order.
   */
  function reportPictures(sheet) {
    const images = sheet.images ?? [];
    const byRow = (left, right) => left.row - right.row;
    const anchored = images.filter((image) => image.row >= 147 && image.column === 5);

    if (anchored.length > 0) {
      return {
        photos: anchored.slice().sort(byRow).slice(0, 2),
        preparedSignature: images.find(
          (image) => image.row >= 129 && image.row <= 131 && image.column <= 5,
        ) ?? null,
        authorisedSignature: images.find(
          (image) => image.row >= 129 && image.row <= 131 && image.column >= 20,
        ) ?? null,
      };
    }

    // Everything the sheet repeats is furniture -- the letterhead is anchored
    // once per printed page. Repetition is detected by `bytes` identity: the
    // reader inflates each media part once and hands every anchor the same
    // array (see `readSheetImages`), so one letterhead is one object.
    const seen = new Set();
    const repeated = new Set();
    for (const image of images) {
      if (seen.has(image.bytes)) repeated.add(image.bytes);
      seen.add(image.bytes);
    }

    // What remains is the report's own content, and its order down the sheet is
    // fixed by the document: the sign-off block, then the appendix.
    const content = images.filter((image) => !repeated.has(image.bytes)).sort(byRow);
    const [preparedSignature = null, authorisedSignature = null] = content
      .slice(-4, -2)
      .sort((left, right) => left.column - right.column);

    return { photos: content.slice(-2), preparedSignature, authorisedSignature };
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

  function buildShearSeries(shearSheet) {
    const definitions = [
      { normalStressKpa: "50", displacementColumn: "E", stressColumn: "F" },
      { normalStressKpa: "100", displacementColumn: "K", stressColumn: "L" },
      { normalStressKpa: "150", displacementColumn: "Q", stressColumn: "R" },
    ];
    return definitions.map((definition) => {
      const points = [];
      for (let row = 10; row <= 60; row += 1) {
        const displacementMm = text(shearSheet, `${definition.displacementColumn}${row}`);
        const shearStressKpa = text(shearSheet, `${definition.stressColumn}${row}`);
        if (displacementMm !== "" && shearStressKpa !== "") {
          points.push({ displacementMm, shearStressKpa });
        }
      }
      return {
        normalStressKpa: definition.normalStressKpa,
        points,
      };
    });
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
    const shearSheet = sheetsByName.get(group.shearSheetName);
    const cover = coverReader(coverSheet);
    const jobRef = cover.value("Job Ref.", 28) || text(reportSheet, "AE2");
    const { photos, preparedSignature, authorisedSignature } = reportPictures(reportSheet);
    // The address runs onto the row below its label, and each list runs six
    // rows from its own -- both are the reference page's fixed shape, so only
    // where they start moves with the sheet.
    const addressRow = cover.row("Address", 6);
    const methodRow = cover.row("Test Method", 14);
    const standardRow = cover.row("Test Standards", 21);

    return {
      schemaVersion: 2,
      groupIndex: group.index,
      pageCount: 5,
      sourceName,
      sourceSheets: { ...group },
      jobRef,
      cover: {
        clientName: cover.value("Client Name", 5),
        addressLines: [
          text(coverSheet, `K${addressRow}`),
          text(coverSheet, `K${addressRow + 1}`),
        ],
        telephoneFax: cover.value("Tel No/Fax No", 8),
        email: cover.value("Email", 9),
        attentionTo: cover.value("Attention to", 10),
        projectTitle: cover.value("Project Code/Title", 12),
        testMethods: pairedRows(coverSheet, "K", "L", methodRow, methodRow + 5),
        testStandards: pairedRows(coverSheet, "K", "L", standardRow, standardRow + 5),
        jobRef,
        vesselName: cover.value("Vessel Name", 29),
        voyageNumber: cover.value("VOY No.", 30),
        sampleId: cover.value("Client Ref./Sample ID", 31),
        samplingDate: cover.value("Sampling Date", 32),
        dateReceived: cover.value("Date Received", 33),
        dateOfReport: cover.value("Date of Report", 34),
        totalPages: cover.value("Total Pages", 36),
        remarks: cover.value("Remarks", 37),
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
        series: buildShearSeries(shearSheet),
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
        photos,
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
