/**
 * @file excel-mapping.js
 * @description Domain module managing field extraction and structure validation
 * for the full 5-page DocuAlign report format based on `rak_pdf_excel_field_mapping.json`.
 */
import mappingDoc from "../../rak_pdf_excel_field_mapping.json";

const REQUIRED_FULL_REPORT_KEYS = [
  "client_name",
  "job_ref",
  "page_2_job_ref",
  "sampling_date",
  "psd_sieve_size_mm",
];

/**
 * Filter the field mappings by targeted PDF output page (1 through 5).
 * @param {number} pageNumber - Page index (1-based).
 * @returns {Array<Object>} Mappings belonging to that page.
 */
export function getMappingsByPage(pageNumber) {
  return mappingDoc.mapping.filter((entry) => entry.pdf_page === Number(pageNumber));
}

/**
 * Filter the field mappings by report section name.
 * @param {string} sectionName - Section title (e.g. 'Particle Size Distribution').
 * @returns {Array<Object>} Mappings belonging to that section.
 */
export function getMappingsBySection(sectionName) {
  return mappingDoc.mapping.filter((entry) => entry.pdf_section === sectionName);
}

/**
 * Extract all unique Excel workbook sheet and tab names referenced in mapping rules.
 * @returns {Array<string>} List of workbook sheet names (e.g. `'CV1 (2)'`, `'TR1 (4)'`).
 */
export function getSheetNames() {
  const sheets = new Set();
  mappingDoc.mapping.forEach((entry) => {
    if (entry.excel_source) {
      const match = entry.excel_source.match(/^('[^']+'|[^!]+)/);
      if (match && match[1]) {
        sheets.add(match[1]);
      }
    }
  });
  return Array.from(sheets);
}

/**
 * Transform a dictionary of raw Excel cell lookups into a structured full-report object.
 * @param {Record<string, any>} rawCellLookup - Mapping of cell references (e.g., `'CV1 (2)'!K5`) to values.
 * @returns {Record<string, any>} Structured report object keyed by semantic suggested keys.
 */
export function extractMappedReport(rawCellLookup = {}) {
  const extracted = {};
  mappingDoc.mapping.forEach((entry) => {
    if (entry.suggested_key && entry.excel_source) {
      if (entry.excel_source in rawCellLookup) {
        extracted[entry.suggested_key] = rawCellLookup[entry.excel_source];
      }
    }
  });
  return extracted;
}

/**
 * Validate that a processed report payload satisfies essential keys for the full 5-page report format.
 * @param {Record<string, any>} reportData - The extracted report data object.
 * @returns {{ isValid: boolean, missingKeys: string[] }} Validation status and missing required keys.
 */
export function validateFullReportStructure(reportData = {}) {
  const missingKeys = REQUIRED_FULL_REPORT_KEYS.filter(
    (key) => !(key in reportData) || reportData[key] === null || reportData[key] === undefined || reportData[key] === ""
  );

  return {
    isValid: missingKeys.length === 0,
    missingKeys,
  };
}
