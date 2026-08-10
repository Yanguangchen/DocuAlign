/**
 * @file zip-writer.test.js
 * @description Behavioral coverage for the classic-script ZIP archive builder
 * the workspace export uses to bundle every document into one download.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("zip writer", () => {
  let docuAlignZip;

  beforeEach(async () => {
    vi.resetModules();
    delete globalThis.docuAlignZip;
    await import("./zip-writer.js");
    docuAlignZip = globalThis.docuAlignZip;
  });

  /**
   * Read back a stored-only ZIP archive's entries, mirroring how a real
   * archive tool would parse the local file headers.
   * @param {Uint8Array} bytes - Archive bytes.
   * @returns {Array<{name: string, method: number, crc: number, data: Uint8Array}>} Entries.
   */
  function readEntries(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const decoder = new TextDecoder();
    const entries = [];
    let offset = 0;

    while (view.getUint32(offset, true) === 0x04034b50) {
      const method = view.getUint16(offset + 8, true);
      const crc = view.getUint32(offset + 14, true);
      const dataLength = view.getUint32(offset + 22, true);
      const nameLength = view.getUint16(offset + 26, true);
      const nameStart = offset + 30;
      const dataStart = nameStart + nameLength;
      entries.push({
        name: decoder.decode(bytes.subarray(nameStart, dataStart)),
        method,
        crc,
        data: bytes.subarray(dataStart, dataStart + dataLength),
      });
      offset = dataStart + dataLength;
    }
    return { entries, centralDirectoryOffset: offset };
  }

  it("marks entry names as UTF-8 so a name is read back as it was written", () => {
    // Entries carry the names staff gave the documents, so an unzip tool has
    // to be told the names are UTF-8 rather than the legacy DOS code page.
    const name = "X-2026-1338 (AV-2620N_RAK SUMMARY).pdf";
    const archive = docuAlignZip.createArchive([
      { name, data: new TextEncoder().encode("%PDF-1.4") },
    ]);
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);

    // General-purpose bit 11, in the local header and the central directory.
    const { entries, centralDirectoryOffset } = readEntries(archive);
    expect(view.getUint16(6, true) & 0x0800).toBe(0x0800);
    expect(view.getUint16(centralDirectoryOffset + 8, true) & 0x0800).toBe(0x0800);
    expect(entries[0].name).toBe(name);
  });

  it("refuses to build an archive with nothing in it", () => {
    expect(() => docuAlignZip.createArchive([])).toThrow(/at least one file/);
    expect(() => docuAlignZip.createArchive(undefined)).toThrow(/at least one file/);
  });

  it("packs one file so a real unzip tool can read it back", () => {
    const data = new TextEncoder().encode("%PDF-1.4 fake report bytes");
    const archive = docuAlignZip.createArchive([{ name: "report.pdf", data }]);

    const { entries } = readEntries(archive);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("report.pdf");
    expect(entries[0].method).toBe(0); // stored, not deflated
    expect(entries[0].crc).toBe(docuAlignZip.crc32(data));
    expect([...entries[0].data]).toEqual([...data]);

    // The end-of-central-directory record must be present and report one entry.
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
    expect(view.getUint32(archive.length - 22, true)).toBe(0x06054b50);
    expect(view.getUint16(archive.length - 22 + 10, true)).toBe(1);
  });

  it("packs several files, each independently recoverable in order", () => {
    const files = [
      { name: "report/report-A.pdf", data: new Uint8Array([1, 2, 3]) },
      { name: "report/report-B.pdf", data: new Uint8Array([4, 5, 6, 7]) },
      { name: "report/Summary.pdf", data: new Uint8Array(0) },
    ];
    const archive = docuAlignZip.createArchive(files);

    const { entries } = readEntries(archive);
    expect(entries.map((entry) => entry.name)).toEqual(files.map((file) => file.name));
    entries.forEach((entry, index) => {
      const original = files.at(index);
      expect([...entry.data]).toEqual([...original.data]);
      expect(entry.crc).toBe(docuAlignZip.crc32(original.data));
    });
  });

  it("accepts an ArrayBuffer payload the same as a Uint8Array", () => {
    const bytes = new Uint8Array([9, 8, 7]);
    const archive = docuAlignZip.createArchive([
      { name: "from-buffer.bin", data: bytes.buffer },
    ]);

    const { entries } = readEntries(archive);
    expect([...entries[0].data]).toEqual([9, 8, 7]);
  });

  it("rejects a payload that is neither bytes nor a buffer", () => {
    expect(() => docuAlignZip.createArchive([{ name: "x", data: "not bytes" }]))
      .toThrow(TypeError);
  });

  it("gives two files with identical content different, correct checksums", () => {
    // A CRC-32 regression here would silently corrupt every archive; check it
    // against values that are independently known to be correct.
    expect(docuAlignZip.crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(docuAlignZip.crc32(new Uint8Array(0))).toBe(0);
  });
});
