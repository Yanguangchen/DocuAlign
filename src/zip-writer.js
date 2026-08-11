/**
 * @file zip-writer.js
 * @description Builds a ZIP archive in the browser so an export downloads as
 * one file instead of a burst of separate PDFs.
 *
 * Entries are stored uncompressed: the payloads are PDFs, which are already
 * compressed, so deflating them again costs time and saves almost nothing.
 * That also keeps this to the header layout `src/xlsx-reader.js` already
 * reads, with no compressor to carry.
 *
 * This file intentionally remains classic-script compatible (no `import` /
 * `export`) so the workspace keeps working over `file://`. It publishes its
 * API on `globalThis.docuAlignZip`.
 */
(function initZipWriter() {
  const LOCAL_HEADER_SIGNATURE = 0x04034b50;
  const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
  const END_OF_DIRECTORY_SIGNATURE = 0x06054b50;
  /** Stored, i.e. no compression. */
  const METHOD_STORE = 0;
  /** ZIP needs a DOS timestamp; entries carry a fixed one so archives are reproducible. */
  const DOS_TIME = 0;
  const DOS_DATE = 0x2821; // 2000-01-01
  /**
   * General-purpose bit 11: entry names are UTF-8 rather than the legacy DOS
   * code page. Names carry document titles staff typed, so an unzipper has to
   * be told how to read anything outside ASCII.
   */
  const UTF8_NAMES = 0x0800;

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      Reflect.set(table, index, value >>> 0);
    }
    return table;
  })();

  /**
   * CRC-32 of a byte sequence, as ZIP's central directory requires.
   * @param {Uint8Array} bytes - Entry contents.
   * @returns {number} Unsigned CRC-32.
   */
  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc = CRC_TABLE.at((crc ^ byte) & 0xff) ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  /**
   * Normalise one entry's payload to bytes.
   * @param {Uint8Array|ArrayBuffer} data - Entry contents.
   * @returns {Uint8Array} Byte view.
   */
  function toBytes(data) {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    throw new TypeError("Archive entries must be provided as bytes.");
  }

  /**
   * Pack one file into a ZIP archive.
   *
   * Names are used verbatim, so the caller decides the folder layout: a name
   * containing `/` places the entry in that folder inside the archive.
   * @param {Array<{name: string, data: Uint8Array|ArrayBuffer}>} entries - Files to archive.
   * @returns {Uint8Array} The archive bytes.
   * @throws {TypeError} When no entries are supplied.
   */
  function createArchive(entries) {
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new TypeError("An archive needs at least one file.");
    }

    const encoder = new TextEncoder();
    const locals = [];
    const centrals = [];
    let offset = 0;

    entries.forEach((entry) => {
      const name = encoder.encode(entry.name);
      const data = toBytes(entry.data);
      const checksum = crc32(data);

      const local = new Uint8Array(30 + name.length + data.length);
      const localView = new DataView(local.buffer);
      localView.setUint32(0, LOCAL_HEADER_SIGNATURE, true);
      localView.setUint16(4, 20, true);
      localView.setUint16(6, UTF8_NAMES, true);
      localView.setUint16(8, METHOD_STORE, true);
      localView.setUint16(10, DOS_TIME, true);
      localView.setUint16(12, DOS_DATE, true);
      localView.setUint32(14, checksum, true);
      localView.setUint32(18, data.length, true);
      localView.setUint32(22, data.length, true);
      localView.setUint16(26, name.length, true);
      local.set(name, 30);
      local.set(data, 30 + name.length);
      locals.push(local);

      const central = new Uint8Array(46 + name.length);
      const centralView = new DataView(central.buffer);
      centralView.setUint32(0, CENTRAL_HEADER_SIGNATURE, true);
      centralView.setUint16(4, 20, true);
      centralView.setUint16(6, 20, true);
      centralView.setUint16(8, UTF8_NAMES, true);
      centralView.setUint16(10, METHOD_STORE, true);
      centralView.setUint16(12, DOS_TIME, true);
      centralView.setUint16(14, DOS_DATE, true);
      centralView.setUint32(16, checksum, true);
      centralView.setUint32(20, data.length, true);
      centralView.setUint32(24, data.length, true);
      centralView.setUint16(28, name.length, true);
      centralView.setUint32(42, offset, true);
      central.set(name, 46);
      centrals.push(central);

      offset += local.length;
    });

    const directorySize = centrals.reduce((total, part) => total + part.length, 0);
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, END_OF_DIRECTORY_SIGNATURE, true);
    endView.setUint16(8, entries.length, true);
    endView.setUint16(10, entries.length, true);
    endView.setUint32(12, directorySize, true);
    endView.setUint32(16, offset, true);

    const parts = [...locals, ...centrals, end];
    const archive = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
    let cursor = 0;
    parts.forEach((part) => {
      archive.set(part, cursor);
      cursor += part.length;
    });
    return archive;
  }

  globalThis.docuAlignZip = Object.freeze({ createArchive, crc32 });
})();
