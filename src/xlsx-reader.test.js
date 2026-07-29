/**
 * @file xlsx-reader.test.js
 * @description Behavioral coverage for the dependency-free XLSX reader,
 * exercised against the real `SampleDocuments/SampleInput.xlsx` workbook so the
 * report-group detection contract is verified on production-shaped data.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { deflateRawSync } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";
import mappingDoc from "../rak_pdf_excel_field_mapping.json";

const workbookBytes = readFileSync(resolve(".", "SampleDocuments/SampleInput.xlsx"));

/**
 * Build a minimal ZIP archive so container and cell-parsing paths can be
 * exercised on precisely controlled OOXML parts.
 * @param {Array<{name: string, data: (string|Uint8Array), method?: number, rawSize?: number}>} files - Entries.
 * @returns {Uint8Array} The archive bytes.
 */
function buildZip(files) {
  const encoder = new TextEncoder();
  const locals = [];
  const centrals = [];
  let offset = 0;

  files.forEach((file) => {
    const name = encoder.encode(file.name);
    const payload = typeof file.data === "string" ? encoder.encode(file.data) : file.data;
    const method = file.method ?? 0;
    const rawSize = file.rawSize ?? payload.length;

    const local = new Uint8Array(30 + name.length + payload.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(8, method, true);
    localView.setUint32(18, payload.length, true);
    localView.setUint32(22, rawSize, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(payload, 30 + name.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(10, method, true);
    centralView.setUint32(20, payload.length, true);
    centralView.setUint32(24, rawSize, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);

    offset += local.length;
  });

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, files.length, true);
  eocdView.setUint16(10, files.length, true);
  eocdView.setUint32(12, centralSize, true);
  eocdView.setUint32(16, offset, true);

  const parts = [...locals, ...centrals, eocd];
  const archive = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let cursor = 0;
  parts.forEach((part) => {
    archive.set(part, cursor);
    cursor += part.length;
  });
  return archive;
}

/**
 * Wrap worksheet XML in the minimum parts a workbook needs.
 * @param {string} sheetXml - Worksheet XML body.
 * @param {Object} [options] - Extra entry options applied to the worksheet part.
 * @returns {Array<Object>} ZIP entry descriptors.
 */
function minimalWorkbookParts(sheetXml, options = {}) {
  return [
    {
      name: "xl/workbook.xml",
      data: '<workbook><sheets><sheet name="CV1" r:id="rId1"/></sheets></workbook>',
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: '<Relationships><Relationship Id="rId1" Target="/xl/worksheets/sheet1.xml"/></Relationships>',
    },
    Object.assign({ name: "xl/worksheets/sheet1.xml", data: sheetXml }, options),
  ];
}

let reader;
let parsed;

beforeAll(async () => {
  await import("./xlsx-reader.js");
  reader = globalThis.docuAlignXlsx;
  parsed = await reader.readWorkbook(new Blob([workbookBytes]));
});

describe("xlsx reader", () => {
  it("reads every worksheet name from the sample workbook", () => {
    expect(parsed.sheetNames).toHaveLength(26);
    expect(parsed.sheetNames).toContain("Summary");
    expect(parsed.sheetNames).toContain("CV1 (2)");
    expect(parsed.sheetNames).toContain("DS1  (6)");
  });

  it("keys cells exactly like the mapping document's excel_source column", () => {
    expect(parsed.cells.get("'CV1 (2)'!K5")).toBe("Xinsha Holding Pte Ltd");
    expect(parsed.cells.get("'TR1 (4)'!AE2")).toBe("X-2026-522-4");
    expect(reader.formatSource("CV1 (2)", "K5")).toBe("'CV1 (2)'!K5");
  });

  it("resolves shared strings and skips blank cells", () => {
    expect(parsed.cells.get("'Summary'!L4")).toBe("Test Reports Summary");
    expect(parsed.cells.has("'Summary'!B4")).toBe(false);
  });

  it("detects one report group per CV1/TR1/DS1/SB1 sheet set", () => {
    expect(parsed.reportGroups.map((entry) => entry.group)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(parsed.reportGroups[0].sheets).toEqual({
      CV1: "CV1",
      TR1: "TR1",
      DS1: "DS1 ",
      SB1: "SB1 ",
    });
    expect(parsed.reportGroups[1].sheets.DS1).toBe("DS1  (2)");
  });

  it("excludes incomplete groups and unrecognised sheets", () => {
    expect(reader.detectReportGroups(["Summary", "coral + org", "CV1", "TR1"])).toEqual([]);
    // A malformed duplicate suffix is not a report group.
    expect(reader.detectReportGroups(["CV1 (a)", "TR1 (a)", "DS1  (a)", "SB1  (a)"])).toEqual([]);
    expect(reader.detectReportGroups(["CV1 (9)", "TR1 (9)", "DS1  (9)", "SB1  (9)"])).toEqual([
      { group: 9, sheets: { CV1: "CV1 (9)", TR1: "TR1 (9)", DS1: "DS1  (9)", SB1: "SB1  (9)" } },
    ]);
  });

  it("extracts per-group identity so each group is a distinct report", () => {
    const first = reader.extractReportIdentity(parsed.cells, parsed.reportGroups[0]);
    const fourth = reader.extractReportIdentity(parsed.cells, parsed.reportGroups[3]);

    expect(first.client_name).toBe("Xinsha Holding Pte Ltd");
    expect(first.job_ref).toBe("X-2026-522-1");
    expect(first.vessel_name).toBe("JIAHE 99");
    expect(fourth.job_ref).toBe("X-2026-522-4");
    expect(fourth.page_2_job_ref).toBe("X-2026-522-4");
  });

  it("omits identity keys whose sheet is absent from the group", () => {
    const identity = reader.extractReportIdentity(parsed.cells, { sheets: { TR1: "TR1" } });
    expect(identity).toEqual({ page_2_job_ref: "X-2026-522-1" });
  });

  it("keeps identity cell references in agreement with the mapping document", () => {
    reader.IDENTITY_FIELDS.forEach((field) => {
      const entry = mappingDoc.mapping.find((row) => row.suggested_key === field.key);
      const [, sheet, cell] = entry.excel_source.match(/^'(.+?)'!(.+)$/);
      expect(sheet.replace(/\s*\(\d+\)$/, "")).toBe(field.sheet);
      expect(cell).toBe(field.cell);
    });
  });

  it("rejects files that are not readable OOXML archives", async () => {
    await expect(reader.readWorkbook(new Blob(["not a zip file at all"]))).rejects.toThrow(
      "not a readable .xlsx archive",
    );
  });

  it("reads inline strings, entities, numbers, and skips value-less cells", async () => {
    const sheet = `<worksheet><sheetData><row>
      <c r="A1" t="inlineStr"><is><t>Coral &amp; Shell</t><t> Content</t></is></c>
      <c r="B1"><v>9.55</v></c>
      <c r="C1" s="4"/>
      <c r="D1"><v>   </v></c>
      <c r="E1" t="s"><v>1</v></c>
      <c r="F1" t="s"><v>99</v></c>
    </row></sheetData></worksheet>`;
    const archive = buildZip([
      ...minimalWorkbookParts(sheet),
      {
        name: "xl/sharedStrings.xml",
        // Decimal (&#74;) and hexadecimal (&#x39;) character references.
        data: "<sst><si><t>first</t></si><si><t>Vessel &#74;IAHE &#x39;9</t></si></sst>",
      },
    ]);

    const { cells } = await reader.readWorkbook(new Blob([archive]));
    expect(cells.get("'CV1'!A1")).toBe("Coral & Shell Content");
    expect(cells.get("'CV1'!B1")).toBe("9.55");
    expect(cells.has("'CV1'!C1")).toBe(false);
    expect(cells.has("'CV1'!D1")).toBe(false);
    expect(cells.get("'CV1'!E1")).toBe("Vessel JIAHE 99");
    // An out-of-range shared string index yields no cell rather than throwing.
    expect(cells.has("'CV1'!F1")).toBe(false);
  });

  it("skips worksheets whose part is absent and scans past a trailing comment", async () => {
    const archive = buildZip([
      {
        name: "xl/workbook.xml",
        data:
          "<workbook><sheets>" +
          '<sheet name="CV1" r:id="rId1"/><sheet name="TR1" r:id="rId2"/>' +
          "</sheets></workbook>",
      },
      {
        name: "xl/_rels/workbook.xml.rels",
        data:
          "<Relationships>" +
          '<Relationship Id="rId1" Target="/xl/worksheets/sheet1.xml"/>' +
          '<Relationship Id="rId2" Target="/xl/worksheets/missing.xml"/>' +
          "</Relationships>",
      },
      {
        name: "xl/worksheets/sheet1.xml",
        data: '<worksheet><sheetData><row><c r="A1"><v>5</v></c></row></sheetData></worksheet>',
      },
    ]);

    // Trailing bytes force the end-of-central-directory scan to walk backwards.
    const withComment = new Uint8Array(archive.length + 8);
    withComment.set(archive, 0);

    const { cells, sheetNames } = await reader.readWorkbook(new Blob([withComment]));
    expect(sheetNames).toEqual(["CV1", "TR1"]);
    expect(cells.get("'CV1'!A1")).toBe("5");
    expect([...cells.keys()].some((key) => key.startsWith("'TR1'"))).toBe(false);
  });

  it("tolerates a shared-string cell with no value and a truncated directory", async () => {
    const sheet =
      '<worksheet><sheetData><row><c r="A1" t="s"></c><c r="B1"><v>7</v></c></row></sheetData></worksheet>';
    const archive = buildZip(minimalWorkbookParts(sheet));

    // Overstate the entry count so the directory walk runs off the end.
    const view = new DataView(archive.buffer);
    view.setUint16(archive.length - 22 + 10, 9, true);

    const { cells } = await reader.readWorkbook(new Blob([archive]));
    expect(cells.has("'CV1'!A1")).toBe(false);
    expect(cells.get("'CV1'!B1")).toBe("7");
  });

  it("reads deflate-compressed parts and rejects other compression methods", async () => {
    const sheet = '<worksheet><sheetData><row><c r="A1"><v>42</v></c></row></sheetData></worksheet>';
    const deflated = new Uint8Array(deflateRawSync(Buffer.from(sheet)));
    const inflatable = buildZip(
      minimalWorkbookParts(sheet, { data: deflated, method: 8, rawSize: sheet.length }),
    );
    const { cells } = await reader.readWorkbook(new Blob([inflatable]));
    expect(cells.get("'CV1'!A1")).toBe("42");

    const unsupported = buildZip(minimalWorkbookParts(sheet, { method: 12 }));
    await expect(reader.readWorkbook(new Blob([unsupported]))).rejects.toThrow(
      "unsupported compression method",
    );
  });

  it("inflates stored, fixed-Huffman, and dynamic-Huffman DEFLATE blocks", () => {
    const decode = (text, level) =>
      new TextDecoder().decode(
        reader.inflateRaw(new Uint8Array(deflateRawSync(Buffer.from(text), { level })), text.length),
      );

    const tiny = "<t>ok</t>";
    // Level 0 emits stored blocks; level 1 picks fixed trees for short input;
    // level 9 on repetitive input emits dynamic trees plus back-references.
    const repetitive = "<c r=\"A1\"><v>1</v></c>".repeat(400);

    expect(decode(tiny, 0)).toBe(tiny);
    expect(decode(tiny, 1)).toBe(tiny);
    expect(decode(repetitive, 9)).toBe(repetitive);
  });

  it("renders date-formatted cells as dates and strips float noise", () => {
    // The mapping document expects sampling_date to display as 08/04/2026.
    expect(parsed.cells.get("'CV1 (2)'!K32")).toBe("08/04/2026");
    expect(parsed.cells.get("'CV1 (2)'!K33")).toBe("10/04/2026");
    // Excel caches 1.7999999999999545 for this subtraction; it must read 1.8.
    expect(parsed.cells.get("'DS1  (2)'!V14")).toBe("1.8");
    expect(reader.formatExcelDate(46120)).toBe("08/04/2026");
    expect(reader.normalizeNumber("63.099999999999994")).toBe("63.1");
    expect(reader.normalizeNumber("95")).toBe("95");
    // Non-numeric text is returned untouched.
    expect(reader.normalizeNumber("N/A")).toBe("N/A");
  });

  it("treats cells as plain numbers when the workbook declares no styles", async () => {
    const sheet =
      '<worksheet><sheetData><row><c r="A1" s="7"><v>46120</v></c></row></sheetData></worksheet>';
    const { cells } = await reader.readWorkbook(new Blob([buildZip(minimalWorkbookParts(sheet))]));
    expect(cells.get("'CV1'!A1")).toBe("46120");
  });

  it("ignores a styles part that declares no cell formats", async () => {
    const sheet =
      '<worksheet><sheetData><row><c r="A1" s="0"><v>46120</v></c></row></sheetData></worksheet>';
    const archive = buildZip([
      ...minimalWorkbookParts(sheet),
      // A numFmt without a formatCode, and no cellXfs block at all.
      { name: "xl/styles.xml", data: '<styleSheet><numFmts><numFmt numFmtId="164"/></numFmts></styleSheet>' },
    ]);

    const { cells } = await reader.readWorkbook(new Blob([archive]));
    expect(cells.get("'CV1'!A1")).toBe("46120");
  });

  it("leaves non-numeric untyped values untouched", async () => {
    const sheet =
      '<worksheet><sheetData><row><c r="A1"><v>N/A</v></c></row></sheetData></worksheet>';
    const { cells } = await reader.readWorkbook(new Blob([buildZip(minimalWorkbookParts(sheet))]));
    expect(cells.get("'CV1'!A1")).toBe("N/A");
  });

  it("reshapes a worksheet into a dense grid of only the populated columns", () => {
    const grid = reader.toGrid(
      new Map([
        ["A1", "left"],
        ["C1", "right"],
        ["C3", "below"],
        ["bogus", "ignored"],
      ]),
    );

    // Column B is empty throughout and is dropped entirely.
    expect(grid.columns).toEqual(["A", "C"]);
    expect(grid.rows).toEqual([
      ["left", "right"],
      ["", "below"],
    ]);
  });

  it("round-trips spreadsheet column labels past the single-letter range", () => {
    expect(reader.columnLabel(0)).toBe("A");
    expect(reader.columnLabel(25)).toBe("Z");
    expect(reader.columnLabel(26)).toBe("AA");
    expect(reader.columnLabel(27)).toBe("AB");
    expect(reader.columnLabel(701)).toBe("ZZ");

    // The real workbook uses columns well beyond Z.
    const summary = reader.toGrid(parsed.sheets.get("Summary"));
    expect(summary.columns).toContain("AA");
    expect(summary.rows.length).toBeGreaterThan(0);
  });

  it("exposes per-sheet cell lookups alongside the flat workbook lookup", () => {
    expect(parsed.sheets.get("CV1 (2)").get("K5")).toBe("Xinsha Holding Pte Ltd");
    expect(parsed.sheets.size).toBe(26);
  });

  it("rejects reserved DEFLATE block types", () => {
    // One byte: final-block flag set, block type 3 (reserved).
    expect(() => reader.inflateRaw(new Uint8Array([0b111]), 4)).toThrow(
      "unsupported DEFLATE block",
    );
  });

  it("rejects zip archives that lack a workbook part", async () => {
    // A valid but empty ZIP: end-of-central-directory record only.
    const emptyZip = new Uint8Array([
      0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    await expect(reader.readWorkbook(new Blob([emptyZip]))).rejects.toThrow(
      "missing its xl/workbook.xml part",
    );
  });
});
