import { describe, expect, it } from "vitest";
import mappingDoc from "../../rak_pdf_excel_field_mapping.json";
import {
  extractMappedReport,
  getMappingsByPage,
  getMappingsBySection,
  getSheetNames,
  validateFullReportStructure,
} from "./excel-mapping.js";

describe("excel-mapping domain module (Full 5-page report format)", () => {
  it("returns mappings filtered by page number across pages 1 to 5", () => {
    const page1 = getMappingsByPage(1);
    const page2 = getMappingsByPage(2);
    const page5 = getMappingsByPage(5);

    expect(page1.length).toBeGreaterThan(0);
    expect(page2.length).toBeGreaterThan(0);
    expect(page5.length).toBeGreaterThan(0);
    expect(page1.every((item) => item.pdf_page === 1)).toBe(true);
    expect(page2.every((item) => item.pdf_page === 2)).toBe(true);
  });

  it("returns mappings filtered by section name", () => {
    const psd = getMappingsBySection("Particle Size Distribution");
    const metallic = getMappingsBySection("Metallic Analysis");

    expect(psd.length).toBeGreaterThan(0);
    expect(metallic.length).toBeGreaterThan(0);
    expect(psd.every((item) => item.pdf_section === "Particle Size Distribution")).toBe(true);
  });

  it("extracts unique Excel sheet and tab names across the full report mapping", () => {
    const sheets = getSheetNames();
    expect(sheets).toContain("'CV1 (2)'");
    expect(sheets).toContain("'TR1 (4)'");
  });

  it("extracts a structured report dictionary from raw cell lookup values", () => {
    const rawCells = {
      "'CV1 (2)'!K5": "Xinsha Holding Pte Ltd",
      "'CV1 (2)'!K15": "X-2026-522-3",
      "'TR1 (4)'!AE2": "X-2026-522-4",
    };

    const report = extractMappedReport(rawCells);
    expect(report.client_name).toBe("Xinsha Holding Pte Ltd");
    expect(report.job_ref).toBe("X-2026-522-3");
    expect(report.page_2_job_ref).toBe("X-2026-522-4");
  });

  it("validates full report structure and returns missing required keys if incomplete", () => {
    const completeReport = {
      client_name: "Test Client",
      job_ref: "JOB-123",
      page_2_job_ref: "JOB-123",
      sampling_date: "2026-06-01",
      psd_sieve_size_mm: "3.00; 2.00",
      metallic_analysis_rows: [],
    };

    const validation = validateFullReportStructure(completeReport);
    expect(validation.isValid).toBe(true);
    expect(validation.missingKeys).toHaveLength(0);

    const incompleteReport = { client_name: "Test Client" };
    const incompleteVal = validateFullReportStructure(incompleteReport);
    expect(incompleteVal.isValid).toBe(false);
    expect(incompleteVal.missingKeys).toContain("job_ref");
    expect(incompleteVal.missingKeys).toContain("psd_sieve_size_mm");
  });
});
