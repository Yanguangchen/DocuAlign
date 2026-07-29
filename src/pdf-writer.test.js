/**
 * @file pdf-writer.test.js
 * @description Behavioral coverage for the dependency-free PDF generator,
 * including cross-reference table integrity so the generated files are valid
 * PDFs rather than merely PDF-shaped byte strings.
 */
import { beforeAll, describe, expect, it } from "vitest";

let pdf;

/**
 * Decode generated PDF bytes as latin1 text for structural assertions.
 * @param {Uint8Array} bytes - Generated PDF.
 * @returns {string} The file as text.
 */
function asText(bytes) {
  let text = "";
  bytes.forEach((byte) => {
    text += String.fromCharCode(byte);
  });
  return text;
}

/**
 * Verify every cross-reference offset points at its object header, which is
 * what makes the difference between a readable and a corrupt PDF.
 * @param {string} text - The PDF as text.
 * @returns {number} The number of objects checked.
 */
function assertXrefIntegrity(text) {
  const startxref = text.match(/startxref\s+(\d+)/);
  expect(startxref).not.toBeNull();
  expect(text.slice(Number(startxref[1]), Number(startxref[1]) + 4)).toBe("xref");

  const offsets = [...text.matchAll(/^(\d{10}) 00000 n $/gm)].map((match) => Number(match[1]));
  offsets.forEach((offset, index) => {
    expect(text.slice(offset, offset + `${index + 1} 0 obj`.length)).toBe(`${index + 1} 0 obj`);
  });
  return offsets.length;
}

beforeAll(async () => {
  await import("./pdf-writer.js");
  pdf = globalThis.docuAlignPdf;
});

describe("pdf writer", () => {
  it("produces a structurally valid single-page document", () => {
    const bytes = pdf.createDocument({
      title: "Test Report X-2026-522-2",
      subtitle: "Xinsha Holding Pte Ltd",
      sections: [
        {
          heading: "CV1 (2)",
          columns: ["A", "B"],
          rows: [
            ["Client Name", "Xinsha Holding Pte Ltd"],
            ["Job Ref.", "X-2026-522-2"],
          ],
        },
      ],
    });

    const text = asText(bytes);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(text.match(/\/Type\s*\/Page\b/g)).toHaveLength(1);
    expect(text).toContain("(Test Report X-2026-522-2)");
    expect(text).toContain("(X-2026-522-2)");
    expect(assertXrefIntegrity(text)).toBeGreaterThan(0);
  });

  it("omits the subtitle line when none is supplied", () => {
    const bytes = pdf.createDocument({
      title: "Summary",
      sections: [{ heading: "Summary", columns: ["A"], rows: [["value"]] }],
    });

    const text = asText(bytes);
    expect(text).toContain("(Summary)");
    expect(assertXrefIntegrity(text)).toBeGreaterThan(0);
  });

  it("paginates long tables and repeats the section header", () => {
    const rows = Array.from({ length: 300 }, (_, index) => [`row-${index}`, String(index)]);
    const bytes = pdf.createDocument({
      title: "Long sheet",
      sections: [{ heading: "DS1", columns: ["A", "B"], rows }],
    });

    const text = asText(bytes);
    const pageCount = (text.match(/\/Type\s*\/Page\b/g) ?? []).length;
    expect(pageCount).toBeGreaterThan(1);
    // The heading is redrawn on each page so continued tables stay readable.
    expect((text.match(/\(DS1\)/g) ?? []).length).toBe(pageCount);
    expect(assertXrefIntegrity(text)).toBeGreaterThan(0);
  });

  it("handles sections with no rows or columns", () => {
    const bytes = pdf.createDocument({
      title: "Empty",
      sections: [{ heading: "Blank" }],
    });

    expect(asText(bytes)).toContain("(Blank)");
  });

  it("breaks to a new page when a section heading cannot fit the remainder", () => {
    // Many medium sections push a later heading past the bottom margin, so the
    // heading must move to a fresh page instead of being clipped.
    const sections = Array.from({ length: 12 }, (_, index) => ({
      heading: `Section ${index}`,
      columns: ["A"],
      rows: Array.from({ length: 4 }, (_, row) => [`s${index}-r${row}`]),
    }));

    const bytes = pdf.createDocument({ title: "Many sections", sections });
    const text = asText(bytes);

    expect((text.match(/\/Type\s*\/Page\b/g) ?? []).length).toBeGreaterThan(1);
    // No section is lost to the page break.
    sections.forEach((section) => expect(text).toContain(`(${section.heading})`));
  });

  it("emits a valid document even when no section produces output", () => {
    const bytes = pdf.createDocument({ title: "Nothing", sections: [] });
    const text = asText(bytes);

    expect(text).toContain("(Nothing)");
    expect(assertXrefIntegrity(text)).toBeGreaterThan(0);
  });

  it("escapes PDF string delimiters and replaces unrenderable characters", () => {
    expect(pdf.escapeText("a(b)c\\d")).toBe("a\\(b\\)c\\\\d");
    // The standard fonts are latin1; anything beyond it degrades to '?'.
    expect(pdf.escapeText("coral — 漢字")).toBe("coral ? ??");
    expect(pdf.escapeText("line\nbreak")).toBe("line break");
  });

  it("clips text that cannot fit its column", () => {
    expect(pdf.clipText("short", 500)).toBe("short");
    const clipped = pdf.clipText("an extremely long worksheet label", 30);
    expect(clipped.endsWith("..")).toBe(true);
    expect(clipped.length).toBeLessThan("an extremely long worksheet label".length);
    // Even an unusably narrow column still renders at least one character.
    expect(pdf.clipText("value", 0).length).toBeGreaterThan(0);
  });

  it("skips blank cells and cells beyond the declared columns", () => {
    const bytes = pdf.createDocument({
      title: "Sparse",
      sections: [
        {
          heading: "Sparse",
          columns: ["A", "B"],
          rows: [["", "kept"], [undefined, "also kept"], ["a", "b", "dropped"]],
        },
      ],
    });

    const text = asText(bytes);
    expect(text).toContain("(kept)");
    expect(text).not.toContain("(dropped)");
  });
});
