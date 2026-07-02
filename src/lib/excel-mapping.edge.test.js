import { describe, expect, it, vi } from "vitest";

// Exercise the defensive branches in excel-mapping.js that the production
// mapping document never triggers: entries with missing excel_source or
// suggested_key fields, and sources whose sheet prefix cannot be parsed.
vi.mock("../../rak_pdf_excel_field_mapping.json", () => ({
  default: {
    mapping: [
      {
        pdf_page: 1,
        pdf_section: "Cover",
        suggested_key: "client_name",
        excel_source: "'CV1 (2)'!K5",
      },
      { pdf_page: 1, pdf_section: "Cover", suggested_key: "orphan_key" },
      { pdf_page: 2, pdf_section: "PSD", excel_source: "'TR1 (4)'!AE2" },
      { pdf_page: 2, pdf_section: "PSD", suggested_key: "bad_source", excel_source: "!A1" },
      { pdf_page: 3, pdf_section: "Moisture", suggested_key: "empty_source", excel_source: "" },
    ],
  },
}));

describe("excel-mapping defensive branches", () => {
  it("skips entries without a parseable sheet prefix when collecting sheet names", async () => {
    const { getSheetNames } = await import("./excel-mapping.js");
    const sheets = getSheetNames();
    expect(sheets).toEqual(["'CV1 (2)'", "'TR1 (4)'"]);
  });

  it("ignores entries missing suggested_key or excel_source during extraction", async () => {
    const { extractMappedReport } = await import("./excel-mapping.js");
    const report = extractMappedReport({
      "'CV1 (2)'!K5": "Xinsha Holding Pte Ltd",
      "'TR1 (4)'!AE2": "X-2026-522-4",
      "!A1": "unreachable-but-mapped",
    });

    expect(report.client_name).toBe("Xinsha Holding Pte Ltd");
    expect(report.bad_source).toBe("unreachable-but-mapped");
    expect(report).not.toHaveProperty("orphan_key");
    expect(report).not.toHaveProperty("empty_source");
  });

  it("skips mapped cells that are absent from the raw lookup", async () => {
    const { extractMappedReport } = await import("./excel-mapping.js");
    expect(extractMappedReport({})).toEqual({});
    expect(extractMappedReport()).toEqual({});
  });
});
