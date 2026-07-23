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
        { name: "CV1 (2)", cells: { K5: null } },
        { name: "TR1 (2)", cells: { AE2: "FALLBACK-JOB" } },
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
});
