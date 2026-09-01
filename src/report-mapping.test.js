/**
 * @file report-mapping.test.js
 * @description Golden coverage for the workbook-to-five-page-report mapping,
 * including repeated report groups and the real sample workbook.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as XLSX from "xlsx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import mappingDoc from "../rak_pdf_excel_field_mapping.json";

async function loadMappingModules() {
  await import("./workbook-pdf.js");
  await import("./report-mapping.js");
  return {
    workbook: globalThis.docuAlignWorkbookPdf,
    mapping: globalThis.docuAlignReportMapping,
  };
}

async function parseReferenceWorkbook() {
  const bytes = readFileSync(resolve("SampleDocuments/SampleInput.xlsx"));
  const file = {
    name: "SampleInput.xlsx",
    arrayBuffer: vi.fn(async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
  };
  const { workbook, mapping } = await loadMappingModules();
  return {
    parsed: await workbook.parseWorkbook(file, XLSX),
    mapping,
  };
}

describe("semantic workbook report mapping", () => {
  beforeEach(() => {
    vi.resetModules();
    delete globalThis.docuAlignWorkbookPdf;
    delete globalThis.docuAlignReportMapping;
  });

  afterEach(() => {
    delete globalThis.docuAlignWorkbookPdf;
    delete globalThis.docuAlignReportMapping;
  });

  it("discovers the six CV/TR/DS/SB report groups in numeric order", async () => {
    const { mapping } = await loadMappingModules();
    const groups = mapping.discoverReportGroups([
      "Summary",
      "CV1 (3)",
      "TR1 (3)",
      "DS1  (3)",
      "SB1  (3)",
      "CV1",
      "TR1",
      "DS1 ",
      "SB1 ",
      "CV1 (2)",
      "TR1 (2)",
      "DS1  (2)",
      "SB1  (2)",
    ]);

    expect(groups).toEqual([
      {
        index: 1,
        coverSheetName: "CV1",
        reportSheetName: "TR1",
        dataSheetName: "DS1 ",
        shearSheetName: "SB1 ",
      },
      {
        index: 2,
        coverSheetName: "CV1 (2)",
        reportSheetName: "TR1 (2)",
        dataSheetName: "DS1  (2)",
        shearSheetName: "SB1  (2)",
      },
      {
        index: 3,
        coverSheetName: "CV1 (3)",
        reportSheetName: "TR1 (3)",
        dataSheetName: "DS1  (3)",
        shearSheetName: "SB1  (3)",
      },
    ]);
  });

  it("maps the real sample-2 workbook values to the five-page PDF model", async () => {
    const { parsed, mapping } = await parseReferenceWorkbook();
    const reports = mapping.buildMappedReports(parsed);
    const sample = reports.find((report) => report.groupIndex === 2);

    expect(reports).toHaveLength(6);
    expect(reports.map((report) => report.jobRef)).toEqual([
      "X-2026-522-1",
      "X-2026-522-2",
      "X-2026-522-3",
      "X-2026-522-4",
      "X-2026-522-5",
      "X-2026-522-6",
    ]);
    expect(sample).toMatchObject({
      pageCount: 5,
      jobRef: "X-2026-522-2",
      cover: {
        clientName: "Xinsha Holding Pte Ltd",
        addressLines: [
          "9 Temasek Boulevard #22-03 Suntec Tower 2",
          "Singapore 038989",
        ],
        telephoneFax: "66630637/66630657",
        email: "shu@xinshaholding.com",
        attentionTo: "Mr Shu Changhong",
        projectTitle: "Reclamation Sand Testing",
        jobRef: "X-2026-522-2",
        vesselName: "JIAHE 99",
        voyageNumber: "JH99-96N",
        sampleId: "3-A",
        samplingDate: "08/04/2026",
        dateReceived: "10/04/2026",
        dateOfReport: "13/04/2026",
        totalPages: "5 (including cover page)",
      },
      siltCoral: {
        siltPercent: "0.5",
        coralShellPercent: "0.7",
        totalPercent: "1.2",
        requirement: "Not more than 15%",
      },
      moisture: {
        percent: "9.7",
        remark: "Oven-drying method was used for the determination of moisture content",
      },
      directShear: {
        maximumDryDensity: "1.68",
        minimumDryDensity: "1.43",
        retainedOn2mmPercent: "16",
        shearingRate: "1.5",
        condition: "Condition for relative density of 35%",
        initialBulkDensity: "1.65",
        initialDryDensity: "1.51",
        angle: "38",
        requirement: "Limit of 32°-45°",
      },
      organicMatter: {
        percent: "0.11",
      },
      signoff: {
        preparedByName: "Jocelyn Lee Jia Min",
        preparedByTitle: "Lab Engineer",
        authorisedByName: "Ken Lee",
        authorisedByTitle: "Managing Director",
      },
      appendix: {
        title: "APPENDIX",
        label: "Photographs of sample received:",
      },
    });
    expect(sample.cover.testMethods).toEqual([
      "1) Particle Size Distribution",
      "2) Silt and Coral/Shell Content",
      "3) Moisture Content",
      "4) Shear Strength by Direct Shear (Small Shearbox Apparatus)",
      "5) Determination of Organic Content",
      "6) 12 Metallic Elements Analysis",
    ]);
    expect(sample.psd.rows).toEqual([
      { sieveSizeMm: "3.00", cumulativePassingPercent: "95", lowerLimit: "85", upperLimit: "100" },
      { sieveSizeMm: "2.00", cumulativePassingPercent: "84", lowerLimit: "60", upperLimit: "100" },
      { sieveSizeMm: "1.18", cumulativePassingPercent: "57", lowerLimit: "30", upperLimit: "85" },
      { sieveSizeMm: "0.850", cumulativePassingPercent: "35", lowerLimit: "15", upperLimit: "75" },
      { sieveSizeMm: "0.600", cumulativePassingPercent: "26", lowerLimit: "10", upperLimit: "50" },
      { sieveSizeMm: "0.200", cumulativePassingPercent: "7", lowerLimit: "0", upperLimit: "15" },
      { sieveSizeMm: "0.063", cumulativePassingPercent: "1", lowerLimit: "0", upperLimit: "10" },
    ]);
    expect(sample.directShear.rows).toEqual([
      { normalStressKpa: "0", maxShearStressKpa: "0", horizontalDisplacementMm: "0" },
      { normalStressKpa: "50", maxShearStressKpa: "35", horizontalDisplacementMm: "3.14" },
      { normalStressKpa: "100", maxShearStressKpa: "77", horizontalDisplacementMm: "4.61" },
      { normalStressKpa: "150", maxShearStressKpa: "114", horizontalDisplacementMm: "4.71" },
    ]);
    expect(sample.directShear.series).toHaveLength(3);
    expect(sample.directShear.series.map((series) => series.normalStressKpa)).toEqual([
      "50",
      "100",
      "150",
    ]);
    expect(sample.directShear.series[0].points).toEqual(expect.arrayContaining([
      { displacementMm: "0.00", shearStressKpa: "0.0" },
      { displacementMm: "3.14", shearStressKpa: "34.9" },
    ]));
    expect(sample.directShear.series[2].points).toContainEqual({
      displacementMm: "4.71",
      shearStressKpa: "114.3",
    });
    expect(sample.metals.rows).toHaveLength(12);
    expect(sample.metals.rows[0]).toEqual({
      element: "Arsenic, As",
      resultPpm: "N/A",
      upperLimitPpm: "30",
    });
    expect(sample.metals.rows.at(-1)).toEqual({
      element: "Zinc, Zn",
      resultPpm: "N/A",
      upperLimitPpm: "200",
    });
    expect(sample.assets.preparedSignature?.mimeType).toBe("image/png");
    expect(sample.assets.authorisedSignature?.mimeType).toBe("image/jpeg");
    expect(sample.appendix.photos).toHaveLength(2);
    expect(sample.appendix.photos.every((photo) => photo.mimeType === "image/jpeg")).toBe(true);
  });

  it("keeps the checked-in mapping anchored to the sample-2 PDF truth", () => {
    const serialized = JSON.stringify(mappingDoc);

    expect(mappingDoc.notes["Exported report format"]).toContain("CV1 (2)");
    expect(mappingDoc.notes["Exported report format"]).toContain("TR1 (2)");
    expect(serialized).not.toMatch(/TR1 \(4\)|DS1\s+\(4\)|SB1\s+\(4\)|OM1|MET1/);
    expect(
      mappingDoc.mapping
        .filter((entry) => entry.pdf_page > 1 && entry.excel_source.startsWith("'TR1"))
        .every((entry) => entry.excel_source.includes("TR1 (2)")),
    ).toBe(true);
  });

  it("rejects workbooks without complete CV/TR report groups", async () => {
    const { mapping } = await loadMappingModules();

    expect(() => mapping.buildMappedReports({ sheets: [] })).toThrow(
      "does not contain any complete report groups",
    );
    expect(() => mapping.buildMappedReports({ sheets: null })).toThrow(
      "does not contain any complete report groups",
    );
    expect(mapping.discoverReportGroups(["CV1 (2)", "DS1  (2)"])).toEqual([]);
    expect(mapping.discoverReportGroups([
      "CV1 (x)",
      "TR1 (01)",
      "CV1 (0)",
      "TR1 (-2)",
    ])).toEqual([]);
  });

  it("uses documented defaults when optional cells and images are absent", async () => {
    const { mapping } = await loadMappingModules();
    const reports = mapping.buildMappedReports({
      sheets: [
        { name: "CV1 (2)" },
        { name: "TR1 (2)", cells: { AE2: "FALLBACK-JOB", E24: null } },
      ],
    });

    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      sourceName: "workbook",
      jobRef: "FALLBACK-JOB",
      cover: {
        clientName: "",
        jobRef: "FALLBACK-JOB",
      },
      assets: {
        preparedSignature: null,
        authorisedSignature: null,
      },
      appendix: {
        title: "APPENDIX",
        label: "Photographs of sample received:",
        photos: [],
      },
    });
  });

  it("reads every cover field from its own label's row, not the sample's", async () => {
    const { mapping } = await loadMappingModules();
    // The production case: a client workbook carrying two extra rows above the
    // identity block. Read at the sample's fixed addresses, every field from
    // `Job Ref.` down came off the row ABOVE its label -- the vessel name
    // printed as the sample id, the sampling date as the date received -- on a
    // signed report, with every other value on the page correct.
    const cells = {
      C5: "Client Name", J5: ":", K5: "Xinsha Holding Pte Ltd",
      C6: "Address", J6: ":", K6: "9 Temasek Boulevard #22-03", K7: "Singapore 038989",
      C8: "Tel No/Fax No", J8: ":", K8: "66630637/66630657",
      C9: "Email", J9: ":", K9: "shu@xinshaholding.com",
      C10: "Attention to", J10: ":", K10: "Mr Shu Changhong",
      C12: "Project Code/Title", J12: ":", K12: "Reclamation Sand Testing",
      C16: "Test Method", J16: ":", K16: "1)", L16: "Particle Size Distribution",
      K17: "2)", L17: "Silt and Coral/Shell Content",
      C23: "Test Standards", J23: ":", K23: "1)", L23: "BS 812-103.1:1985",
      C30: "Job Ref.", J30: ":", K30: "X-2026-1549-2",
      C31: "Vessel Name", J31: ":", K31: "HONG HAI 9",
      C32: "VOY No.", J32: ":", K32: "HH9-638N",
      C33: "Client Ref./Sample ID", J33: ":", K33: "1-D",
      C34: "Sampling Date", J34: ":", K34: "28/08/2026",
      C35: "Date Received", J35: ":", K35: "03/09/2026",
      C36: "Date of Report", J36: ":", K36: "05/09/2026",
      C38: "Total Pages", J38: ":", K38: "5 (including cover page)",
      C39: "Remarks", J39: ":", K39: "Please refer to Appendix",
      // Nothing that is not a cell address, and no unlabelled cell, may be
      // mistaken for a label.
      "!ref": "A1:AE200", C40: null, AE1: "Job Ref.",
    };

    const [report] = mapping.buildMappedReports({
      sheets: [
        { name: "CV1", cells },
        { name: "TR1", cells: { AE2: "X-2026-1549-2" } },
      ],
    });

    expect(report.cover).toMatchObject({
      clientName: "Xinsha Holding Pte Ltd",
      addressLines: ["9 Temasek Boulevard #22-03", "Singapore 038989"],
      telephoneFax: "66630637/66630657",
      email: "shu@xinshaholding.com",
      attentionTo: "Mr Shu Changhong",
      projectTitle: "Reclamation Sand Testing",
      jobRef: "X-2026-1549-2",
      vesselName: "HONG HAI 9",
      voyageNumber: "HH9-638N",
      sampleId: "1-D",
      samplingDate: "28/08/2026",
      dateReceived: "03/09/2026",
      dateOfReport: "05/09/2026",
      totalPages: "5 (including cover page)",
      remarks: "Please refer to Appendix",
    });
    // Each list still runs the reference page's six rows, from its own label.
    expect(report.cover.testMethods).toEqual([
      "1) Particle Size Distribution",
      "2) Silt and Coral/Shell Content",
      "",
      "",
      "",
      "",
    ]);
    expect(report.cover.testStandards.at(0)).toBe("1) BS 812-103.1:1985");
  });

  it("resolves a repeated cover label to the row nearest the sample's", async () => {
    const { mapping } = await loadMappingModules();
    // "Remarks" is a word a cover can carry more than once. The field still
    // has to come off the sign-off block's own row rather than whichever
    // occurrence the sheet happens to list first.
    const [report] = mapping.buildMappedReports({
      sheets: [
        {
          name: "CV1",
          cells: {
            C10: "Remarks", K10: "Handling note",
            C37: "Remarks", K37: "Please refer to Appendix",
            C60: "Remarks", K60: "Internal note",
            // A sheet that never labels this field keeps the sample's row.
            K32: "08/04/2026",
          },
        },
        { name: "TR1", cells: { AE2: "X-1" } },
      ],
    });

    expect(report.cover.remarks).toBe("Please refer to Appendix");
    expect(report.cover.samplingDate).toBe("08/04/2026");
  });

  it("finds appendix photographs at a layout the sample's anchor never sees", async () => {
    const { mapping } = await loadMappingModules();
    // A client workbook whose report simply ends earlier: nothing sits at the
    // sample's row 147 / column 5, so the positional anchor finds nothing.
    const letterhead = new Uint8Array([1, 2, 3]);
    const [report] = mapping.buildMappedReports({
      sheets: [
        { name: "CV1 (2)" },
        {
          name: "TR1 (2)",
          cells: { AE2: "SHORTER" },
          images: [
            { name: "letterhead", row: 0, column: 0, bytes: letterhead },
            { name: "letterhead", row: 44, column: 0, bytes: letterhead },
            { name: "letterhead", row: 96, column: 0, bytes: letterhead },
            // The sign-off block closes page 4; the appendix follows on page 5.
            { name: "authorised", row: 89, column: 22, bytes: new Uint8Array([5]) },
            { name: "prepared", row: 89, column: 1, bytes: new Uint8Array([4]) },
            { name: "second-photo", row: 129, column: 2, bytes: new Uint8Array([7]) },
            { name: "first-photo", row: 107, column: 2, bytes: new Uint8Array([6]) },
          ],
        },
      ],
    });

    expect(report.appendix.photos.map((photo) => photo.name)).toEqual([
      "first-photo",
      "second-photo",
    ]);
    expect(report.assets.preparedSignature?.name).toBe("prepared");
    expect(report.assets.authorisedSignature?.name).toBe("authorised");
  });

  it("tells the sign-off's signatures from the appendix by the shape they sit in", async () => {
    const { mapping } = await loadMappingModules();
    const letterhead = new Uint8Array([1, 2, 3]);
    // The real client report this exists for: that workbook's sample
    // photographs had not been pasted in, so once the letterhead is dropped
    // the only pictures left ARE the two signatures. Taking the last two of
    // the list printed them, blown up, under "Photographs of sample received"
    // on a signed report -- and left the sign-off with none of its own.
    const [report] = mapping.buildMappedReports({
      sheets: [
        { name: "CV1" },
        {
          name: "TR1",
          cells: { AE2: "X-2026-1549-1" },
          images: [
            { name: "letterhead", row: 0, column: 0, bytes: letterhead },
            { name: "letterhead", row: 87, column: 0, bytes: letterhead },
            // Side by side, a row apart: the sign-off block, wherever it lands.
            { name: "authorised", row: 129, column: 23, bytes: new Uint8Array([5]) },
            { name: "prepared", row: 130, column: 2, bytes: new Uint8Array([4]) },
          ],
        },
      ],
    });

    expect(report.appendix.photos).toEqual([]);
    expect(report.assets.preparedSignature?.name).toBe("prepared");
    expect(report.assets.authorisedSignature?.name).toBe("authorised");
  });

  it("never reads stacked pictures as a signature pair", async () => {
    const { mapping } = await loadMappingModules();
    const letterhead = new Uint8Array([1, 2, 3]);
    // The appendix stacks its photographs in one column, so two pictures a row
    // apart in the SAME column are photographs, not a sign-off block -- and a
    // sheet carrying only those has photographs and no signatures.
    const [report] = mapping.buildMappedReports({
      sheets: [
        { name: "CV1" },
        {
          name: "TR1",
          cells: { AE2: "X-2026-1549-1" },
          images: [
            { name: "letterhead", row: 0, column: 0, bytes: letterhead },
            { name: "letterhead", row: 87, column: 0, bytes: letterhead },
            { name: "top-photo", row: 148, column: 5, bytes: new Uint8Array([6]) },
            { name: "bottom-photo", row: 150, column: 5, bytes: new Uint8Array([7]) },
          ],
        },
      ],
    });

    expect(report.appendix.photos.map((photo) => photo.name))
      .toEqual(["top-photo", "bottom-photo"]);
    expect(report.assets.preparedSignature).toBeNull();
    expect(report.assets.authorisedSignature).toBeNull();
  });

  it("names a value that is not of its own kind, and stays quiet otherwise", async () => {
    const { parsed, mapping } = await parseReferenceWorkbook();
    // The sample maps cleanly, so the check has to be silent on it -- a
    // warning that cries wolf on every export is not read on the one that
    // matters.
    const reports = mapping.buildMappedReports(parsed);
    expect(reports.flatMap((report) => mapping.describeAnomalies(report))).toEqual([]);

    // The layout defect this catches: read a row out, and the sampling date
    // holds a voyage number. The check does not know which row was right --
    // only what a date looks like, which is enough to say something is wrong.
    const shifted = {
      ...reports[0],
      cover: {
        ...reports[0].cover,
        jobRef: "HONG HAI 9",
        samplingDate: "HH9-638N",
        dateReceived: "",
      },
      moisture: { ...reports[0].moisture, percent: "9,6" },
    };

    expect(mapping.describeAnomalies(shifted)).toEqual([
      { field: "cover.jobRef", label: "Job Ref.", value: "HONG HAI 9", reason: "is not a job reference" },
      { field: "cover.samplingDate", label: "Sampling Date", value: "HH9-638N", reason: "is not a date" },
      { field: "cover.dateReceived", label: "Date Received", value: "", reason: "is empty" },
      { field: "moisture.percent", label: "Moisture Content", value: "9,6", reason: "is not a measurement" },
    ]);

    // A job reference may carry three or four parts; a result may be reported
    // against a detection limit rather than as a bare number. Neither is an
    // anomaly, and a report missing whole sections is entirely anomalous.
    const tolerated = {
      ...shifted,
      cover: { ...shifted.cover, jobRef: "X-2026-1549-1", samplingDate: "28/08/2026", dateReceived: "31/08/2026" },
      siltCoral: { ...shifted.siltCoral, siltPercent: "< 1" },
      moisture: { percent: "9.6" },
    };
    expect(mapping.describeAnomalies(tolerated)).toEqual([]);
    // A model with nothing in it is entirely anomalous: every checked field is
    // empty, and every block canary reads as absent rather than as the form's.
    const bare = mapping.describeAnomalies({}).map((anomaly) => anomaly.reason);
    expect(new Set(bare)).toEqual(new Set(["is empty", "does not read as the form's own"]));
    expect(bare.filter((reason) => reason === "is empty")).toHaveLength(18);
    expect(bare.filter((reason) => reason !== "is empty")).toHaveLength(8);
    // A letter code is what opens a job reference, and every other part counts.
    const badReferences = ["2026-522-1", "X-2026", "X-2026-522-1-9-4", "X-2026-52A-1"];
    for (const jobRef of badReferences) {
      expect(mapping.describeAnomalies({ cover: { jobRef } }).at(0).reason)
        .toBe("is not a job reference");
    }
  });

  it("catches a drifted block through the values the form fixes", async () => {
    const { parsed, mapping } = await parseReferenceWorkbook();
    const [report] = mapping.buildMappedReports(parsed);

    // A result has no shape of its own -- a shear stress of 45.2 is
    // indistinguishable from a moisture content of 45.2 -- so no per-value
    // check can reach one. The labels around it CAN be checked: the sieve
    // series and the twelve element names are fixed by the test method, are
    // already read, and are never drawn. Shifting the metals table by a row
    // is invisible in its results and unmistakable in its element column.
    const shiftedMetals = {
      ...report,
      metals: {
        ...report.metals,
        rows: report.metals.rows.slice(1)
          .concat({ element: "", resultPpm: "N/A", upperLimitPpm: "" }),
      },
    };
    const metalFaults = mapping.describeAnomalies(shiftedMetals);
    expect(metalFaults.map((anomaly) => anomaly.label)).toEqual([
      "the metals table's element column",
      "the metals table's limit column",
    ]);
    expect(metalFaults.every((anomaly) => anomaly.reason === "does not read as the form's own"))
      .toBe(true);

    // Less material passes a finer mesh, always -- so a grading column that
    // climbs has been read off the wrong rows even though every value in it is
    // a perfectly plausible percentage.
    const reversed = {
      ...report,
      psd: { ...report.psd, rows: report.psd.rows.slice().reverse() },
    };
    expect(mapping.describeAnomalies(reversed).map((anomaly) => anomaly.reason))
      .toContain("rises as the sieve gets finer");

    // `N/A` is what the lab writes for a test it did not run -- 7 of the 9
    // reports in the two known workbooks say so -- and must never be flagged.
    const notTested = {
      ...report,
      metals: {
        ...report.metals,
        rows: report.metals.rows.map((row) => ({ ...row, resultPpm: "N/A" })),
      },
    };
    expect(mapping.describeAnomalies(notTested)).toEqual([]);

    // An empty cell in a results column is not a measurement either -- the
    // lab writes `N/A` for a test it did not run, and leaves nothing blank.
    const blankResult = {
      ...report,
      metals: {
        ...report.metals,
        rows: report.metals.rows.map((row, index) =>
          (index === 0 ? { ...row, resultPpm: "" } : row)),
      },
    };
    expect(mapping.describeAnomalies(blankResult).at(0)).toMatchObject({
      label: "Metals result (row 1)",
      reason: "is not a result",
    });

    // A block the model carries but leaves blank is still not the form's own.
    expect(mapping.describeAnomalies({ siltCoral: {} })).toContainEqual({
      field: "siltCoral.requirement",
      label: "the silt and coral block's requirement",
      value: "",
      reason: "does not read as the form's own",
    });

    // A column read off the wrong rows is wrong all the way down, so only the
    // first offending row is named.
    const brokenColumn = {
      ...report,
      metals: {
        ...report.metals,
        rows: report.metals.rows.map((row, index) =>
          (index >= 2 ? { ...row, resultPpm: "HONG HAI 9" } : row)),
      },
    };
    expect(mapping.describeAnomalies(brokenColumn)).toEqual([
      {
        field: "metals.rows.resultPpm",
        label: "Metals result (row 3)",
        value: "HONG HAI 9",
        reason: "is not a result",
      },
    ]);
  });

  it("keeps the letterhead out of the appendix when it sits below the photographs", async () => {
    const { mapping } = await loadMappingModules();
    // The bottom-most picture is not always a photograph: a footer mark below
    // them is still furniture, and repetition is what gives it away.
    const letterhead = new Uint8Array([1, 2, 3]);
    const [report] = mapping.buildMappedReports({
      sheets: [
        { name: "CV1 (2)" },
        {
          name: "TR1 (2)",
          cells: { AE2: "FOOTER" },
          images: [
            { name: "letterhead", row: 0, column: 0, bytes: letterhead },
            { name: "photo", row: 104, column: 2, bytes: new Uint8Array([6]) },
            { name: "footer", row: 200, column: 0, bytes: letterhead },
          ],
        },
      ],
    });

    expect(report.appendix.photos.map((photo) => photo.name)).toEqual(["photo"]);
  });

  it("recovers the real workbook's own pictures at any anchor", async () => {
    // The regression guard for the whole class of defect: a client workbook's
    // appendix sits wherever that report's rows end, so no absolute row or
    // column identifies it. Every picture is shifted here so the sample's
    // anchor cannot match, and each group must still recover ITS OWN
    // photographs and signatures -- not the reference sample's, and not
    // another group's. See documentation/report-export-static-asset-fix.md 16.
    const { parsed, mapping } = await parseReferenceWorkbook();
    const anchored = mapping.buildMappedReports(parsed);
    const identify = (report) => [
      ...report.appendix.photos,
      report.assets.preparedSignature,
      report.assets.authorisedSignature,
    ].map((picture) => picture?.bytes);

    for (const [rowShift, columnShift] of [[-40, -3], [25, 2], [-60, 0]]) {
      const shifted = mapping.buildMappedReports({
        ...parsed,
        sheets: parsed.sheets.map((sheet) => ({
          ...sheet,
          images: sheet.images.map((image) => ({
            ...image,
            row: image.row + rowShift,
            column: image.column + columnShift,
          })),
        })),
      });

      expect(shifted).toHaveLength(anchored.length);
      shifted.forEach((report, index) => {
        const recovered = identify(report);
        const expected = identify(anchored.at(index));
        expect(report.appendix.photos).toHaveLength(2);
        // Reference equality, not deep equality: the reader inflates each media
        // part once and shares the array, so identity is both the stricter
        // check and the only one that stays fast on 170KB photographs.
        recovered.forEach((bytes, picture) => expect(bytes).toBe(expected.at(picture)));
      });
    }
  });

  it("extracts nothing when a report sheet carries only furniture", async () => {
    const { mapping } = await loadMappingModules();
    const letterhead = new Uint8Array([1, 2, 3]);
    const [report] = mapping.buildMappedReports({
      sheets: [
        { name: "CV1 (2)" },
        {
          name: "TR1 (2)",
          cells: { AE2: "NO-PHOTOS" },
          images: [
            { name: "letterhead", row: 0, column: 0, bytes: letterhead },
            { name: "letterhead", row: 44, column: 0, bytes: letterhead },
          ],
        },
      ],
    });

    expect(report.appendix.photos).toEqual([]);
  });

  it("prefers the sample's exact anchor over anything else on the sheet", async () => {
    const { mapping } = await loadMappingModules();
    const [report] = mapping.buildMappedReports({
      sheets: [
        { name: "CV1 (2)" },
        {
          name: "TR1 (2)",
          cells: { AE2: "ANCHORED" },
          images: [
            { name: "stray", row: 145, column: 9 },
            { name: "anchored", row: 150, column: 5 },
          ],
        },
      ],
    });

    expect(report.appendix.photos.map((photo) => photo.name)).toEqual(["anchored"]);
  });
});
