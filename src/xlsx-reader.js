/**
 * @file xlsx-reader.js
 * @description Dependency-free XLSX workbook reader for the DocuAlign ETL
 * workspace. Parses the OOXML ZIP container with the platform `DecompressionStream`
 * and `DOMParser`, exposing sheet names, cell lookups keyed exactly like the
 * `excel_source` column of `rak_pdf_excel_field_mapping.json` (e.g. `'CV1 (2)'!K5`),
 * report-group detection, and report identity extraction.
 *
 * This file intentionally remains classic-script compatible (no `import` /
 * `export`) so the workspace keeps working over `file://`, matching the
 * dual-environment contract in AGENTS.md. It publishes its API on
 * `globalThis.docuAlignXlsx`.
 */
(function initXlsxReader() {
  const ZIP_EOCD_SIGNATURE = 0x06054b50;
  const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
  const ZIP_EOCD_MIN_SIZE = 22;

  /**
   * Cell references that identify a report, expressed as logical keys from
   * `rak_pdf_excel_field_mapping.json`. `src/xlsx-reader.test.js` asserts these
   * stay in agreement with the mapping document so the two cannot drift.
   * @type {Array<{key: string, sheet: string, cell: string}>}
   */
  const IDENTITY_FIELDS = [
    { key: "client_name", sheet: "CV1", cell: "K5" },
    { key: "job_ref", sheet: "CV1", cell: "K28" },
    { key: "vessel_name", sheet: "CV1", cell: "K29" },
    { key: "sampling_date", sheet: "CV1", cell: "K32" },
    { key: "page_2_job_ref", sheet: "TR1", cell: "AE2" },
  ];

  /** Sheet-name prefixes that make up one complete test report group. */
  const GROUP_SHEET_PREFIXES = ["CV1", "TR1", "DS1", "SB1"];

  /**
   * Locate the ZIP end-of-central-directory record by scanning backwards.
   * @param {DataView} view - View over the whole archive.
   * @returns {number} Byte offset of the EOCD record.
   * @throws {Error} When the archive has no readable EOCD record.
   */
  function findEndOfCentralDirectory(view) {
    for (let offset = view.byteLength - ZIP_EOCD_MIN_SIZE; offset >= 0; offset -= 1) {
      if (view.getUint32(offset, true) === ZIP_EOCD_SIGNATURE) return offset;
    }
    throw new Error("Workbook is not a readable .xlsx archive.");
  }

  /**
   * Read the ZIP central directory into per-entry descriptors.
   * @param {ArrayBuffer} buffer - Raw archive bytes.
   * @returns {Map<string, {offset: number, method: number, compressedSize: number, size: number}>} Entries by path.
   */
  function readCentralDirectory(buffer) {
    const view = new DataView(buffer);
    const eocd = findEndOfCentralDirectory(view);
    const entryCount = view.getUint16(eocd + 10, true);
    const decoder = new TextDecoder();
    const entries = new Map();

    let cursor = view.getUint32(eocd + 16, true);
    for (let index = 0; index < entryCount; index += 1) {
      if (view.getUint32(cursor, true) !== ZIP_CENTRAL_SIGNATURE) break;

      const method = view.getUint16(cursor + 10, true);
      const compressedSize = view.getUint32(cursor + 20, true);
      const size = view.getUint32(cursor + 24, true);
      const nameLength = view.getUint16(cursor + 28, true);
      const extraLength = view.getUint16(cursor + 30, true);
      const commentLength = view.getUint16(cursor + 32, true);
      const localOffset = view.getUint32(cursor + 42, true);
      const name = decoder.decode(new Uint8Array(buffer, cursor + 46, nameLength));

      // Skip the local file header to find where the entry payload begins; its
      // name/extra lengths may differ from the central directory copy.
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);

      entries.set(name, {
        offset: localOffset + 30 + localNameLength + localExtraLength,
        method,
        compressedSize,
        size,
      });
      cursor += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
  }

  /* eslint-disable security/detect-object-injection -- Numeric DEFLATE table and
     buffer indices only; every index is derived from bit-width arithmetic. */

  /** RFC 1951 length codes: base values and extra-bit counts for codes 257-285. */
  const LENGTH_BASE = [
    3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
    163, 195, 227, 258,
  ];
  const LENGTH_EXTRA = [
    0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
  ];

  /** RFC 1951 distance codes: base values and extra-bit counts. */
  const DIST_BASE = [
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049,
    3073, 4097, 6145, 8193, 12289, 16385, 24577,
  ];
  const DIST_EXTRA = [
    0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
  ];

  /** Order in which code-length code lengths appear in a dynamic block header. */
  const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

  /**
   * Build a canonical Huffman decoding table from a list of code lengths.
   * @param {Uint8Array} lengths - Code length per symbol.
   * @param {number} count - Number of symbols to consider.
   * @returns {{counts: Uint16Array, symbols: Uint16Array}} Decoding tree.
   */
  function buildHuffmanTree(lengths, count) {
    const counts = new Uint16Array(16);
    for (let i = 0; i < count; i += 1) counts[lengths[i]] += 1;
    counts[0] = 0;

    const offsets = new Uint16Array(16);
    let total = 0;
    for (let i = 1; i < 16; i += 1) {
      offsets[i] = total;
      total += counts[i];
    }

    const symbols = new Uint16Array(count);
    for (let i = 0; i < count; i += 1) {
      if (lengths[i]) {
        symbols[offsets[lengths[i]]] = i;
        offsets[lengths[i]] += 1;
      }
    }
    return { counts, symbols };
  }

  /**
   * The RFC 1951 fixed literal/length and distance trees. Their code lengths are
   * defined by the specification, so they are built once and shared by every
   * type-1 block in every stream.
   * @returns {Object[]} The fixed trees.
   */
  const FIXED_TREES = (() => {
    const literalLengths = new Uint8Array(288);
    literalLengths.fill(8, 0, 144);
    literalLengths.fill(9, 144, 256);
    literalLengths.fill(7, 256, 280);
    literalLengths.fill(8, 280, 288);
    return [buildHuffmanTree(literalLengths, 288), buildHuffmanTree(new Uint8Array(30).fill(5), 30)];
  })();

  /**
   * Decompress a raw DEFLATE (RFC 1951) byte stream.
   *
   * Implemented in-repo rather than via `DecompressionStream("deflate-raw")`
   * because that format is unavailable on some supported runtimes; a single
   * code path keeps behaviour identical across browsers, `file://`, and tests.
   * @param {Uint8Array} source - Raw DEFLATE bytes.
   * @param {number} expectedSize - Uncompressed byte length from the ZIP directory.
   * @returns {Uint8Array} Decompressed bytes.
   * @throws {Error} When the stream is malformed.
   */
  function inflateRaw(source, expectedSize) {
    const out = new Uint8Array(expectedSize);
    let outPos = 0;
    let pos = 0;
    let bitBuffer = 0;
    let bitCount = 0;

    /**
     * Consume `need` bits, least-significant first.
     * @param {number} need - Bit count to read.
     * @returns {number} The bit value.
     */
    function readBits(need) {
      while (bitCount < need) {
        bitBuffer |= source[pos] << bitCount;
        pos += 1;
        bitCount += 8;
      }
      const value = bitBuffer & ((1 << need) - 1);
      bitBuffer >>>= need;
      bitCount -= need;
      return value;
    }

    /**
     * Decode one symbol using a Huffman tree.
     * @param {{counts: Uint16Array, symbols: Uint16Array}} tree - Decoding tree.
     * @returns {number} The decoded symbol.
     */
    function decodeSymbol(tree) {
      let sum = 0;
      let current = 0;
      let length = 0;
      do {
        current = 2 * current + readBits(1);
        length += 1;
        sum += tree.counts[length];
        current -= tree.counts[length];
      } while (current >= 0 && length < 15);
      return tree.symbols[sum + current];
    }

    /**
     * Expand one Huffman-coded block into the output buffer.
     * @param {Object} literalTree - Literal/length tree.
     * @param {Object} distanceTree - Distance tree.
     * @returns {void}
     */
    function inflateBlock(literalTree, distanceTree) {
      for (;;) {
        const symbol = decodeSymbol(literalTree);
        if (symbol === 256) return;

        if (symbol < 256) {
          out[outPos] = symbol;
          outPos += 1;
          continue;
        }

        const lengthCode = symbol - 257;
        const length = LENGTH_BASE[lengthCode] + readBits(LENGTH_EXTRA[lengthCode]);
        const distanceCode = decodeSymbol(distanceTree);
        const distance = DIST_BASE[distanceCode] + readBits(DIST_EXTRA[distanceCode]);

        for (let i = 0; i < length; i += 1) {
          out[outPos] = out[outPos - distance];
          outPos += 1;
        }
      }
    }

    /**
     * Read the dynamic Huffman trees that precede a type-2 block.
     * @returns {Object[]} The literal/length and distance trees.
     */
    function readDynamicTrees() {
      const literalCount = readBits(5) + 257;
      const distanceCount = readBits(5) + 1;
      const codeLengthCount = readBits(4) + 4;

      const codeLengths = new Uint8Array(19);
      for (let i = 0; i < codeLengthCount; i += 1) {
        codeLengths[CODE_LENGTH_ORDER[i]] = readBits(3);
      }
      const codeLengthTree = buildHuffmanTree(codeLengths, 19);

      const lengths = new Uint8Array(literalCount + distanceCount);
      let index = 0;
      while (index < lengths.length) {
        const symbol = decodeSymbol(codeLengthTree);
        if (symbol === 16) {
          const previous = lengths[index - 1];
          for (let repeat = readBits(2) + 3; repeat > 0; repeat -= 1) {
            lengths[index] = previous;
            index += 1;
          }
        } else if (symbol === 17) {
          index += readBits(3) + 3;
        } else if (symbol === 18) {
          index += readBits(7) + 11;
        } else {
          lengths[index] = symbol;
          index += 1;
        }
      }

      return [
        buildHuffmanTree(lengths, literalCount),
        buildHuffmanTree(lengths.subarray(literalCount), distanceCount),
      ];
    }

    let isFinalBlock = 0;
    do {
      isFinalBlock = readBits(1);
      const blockType = readBits(2);

      if (blockType === 0) {
        // Stored block: discard partial bits, then copy the literal run.
        bitBuffer = 0;
        bitCount = 0;
        const length = source[pos] | (source[pos + 1] << 8);
        out.set(source.subarray(pos + 4, pos + 4 + length), outPos);
        outPos += length;
        pos += 4 + length;
      } else if (blockType === 1) {
        inflateBlock(...FIXED_TREES);
      } else if (blockType === 2) {
        inflateBlock(...readDynamicTrees());
      } else {
        throw new Error("Workbook contains an unsupported DEFLATE block.");
      }
    } while (!isFinalBlock);

    return out;
  }

  /* eslint-enable security/detect-object-injection */

  /**
   * Inflate (or pass through) a single archive entry as text.
   * @param {ArrayBuffer} buffer - Raw archive bytes.
   * @param {{offset: number, method: number, compressedSize: number, size: number}} entry - Entry descriptor.
   * @returns {string} Decoded UTF-8 entry contents.
   * @throws {Error} When the entry uses an unsupported compression method.
   */
  function readEntryText(buffer, entry) {
    return new TextDecoder().decode(readEntryBytes(buffer, entry));
  }

  /**
   * Inflate (or pass through) a single archive entry as raw bytes. Embedded
   * pictures are binary, so they must never round-trip through a text decoder.
   * @param {ArrayBuffer} buffer - Raw archive bytes.
   * @param {{offset: number, method: number, compressedSize: number, size: number}} entry - Entry descriptor.
   * @returns {Uint8Array} Decompressed entry contents.
   * @throws {Error} When the entry uses an unsupported compression method.
   */
  function readEntryBytes(buffer, entry) {
    const bytes = new Uint8Array(buffer, entry.offset, entry.compressedSize);
    // Stored entries -- which is how Excel keeps already-compressed pictures --
    // are copied out rather than returned as a view onto the archive. Consumers
    // that read `.buffer` directly, pdf-lib's image embedders among them, ignore
    // a view's byte offset and would otherwise decode from the archive's start.
    if (entry.method === 0) return bytes.slice();
    if (entry.method !== 8) throw new Error("Workbook uses an unsupported compression method.");
    return inflateRaw(bytes, entry.size);
  }

  const NAME_ATTR = /\sname="([^"]*)"/;
  const RID_ATTR = /\sr:id="([^"]*)"/;
  const ID_ATTR = /\sId="([^"]*)"/;
  const TARGET_ATTR = /\sTarget="([^"]*)"/;
  const REF_ATTR = /\sr="([^"]*)"/;
  const TYPE_ATTR = /\st="([^"]*)"/;
  const STYLE_ATTR = /\ss="(\d+)"/;
  const NUMFMTID_ATTR = /\snumFmtId="(\d+)"/;
  const FORMATCODE_ATTR = /\sformatCode="([^"]*)"/;
  const NUMFMT_TAG = /<numFmt\s[^>]*\/?>/g;
  const XF_TAG = /<xf\s[^>]*\/?>/g;
  const CELLXFS_BLOCK = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/;

  // Drawing parts namespace their elements (`xdr:`, `a:`), but the prefix is
  // declared per file and cannot be relied on. Each pattern therefore anchors
  // on the character before the local name -- `<` when unprefixed, `:` when
  // prefixed -- which keeps every quantifier flat and the match linear.
  const ANCHOR_SPLIT = /[:<](?:twoCellAnchor|oneCellAnchor|absoluteAnchor)[\s>]/;
  const ANCHOR_COLUMN = /[:<]col>(\d+)<\//;
  const ANCHOR_ROW = /[:<]row>(\d+)<\//;
  const BLIP_EMBED = /[:<]blip[^>]*\sr:embed="([^"]*)"/;
  const PICTURE_NAME = /[:<]cNvPr[^>]*\sname="([^"]*)"/;

  /** Number-format ids that ECMA-376 reserves for dates and times. */
  const BUILT_IN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

  /**
   * Decimal places of the ECMA-376 built-in numeric formats. These ids never
   * appear as `<numFmt>` tags in `xl/styles.xml`, so their codes are known
   * only from the specification. Percent, scientific, and fraction formats are
   * deliberately absent: they rescale or restructure the value rather than
   * just rounding it, so those cells keep their cached number.
   */
  const BUILT_IN_DECIMAL_FORMATS = new Map([
    [1, 0],
    [2, 2],
    [3, 0],
    [4, 2],
    [37, 0],
    [38, 0],
    [39, 2],
    [40, 2],
  ]);

  /** Days between the Excel serial epoch (1899-12-30) and the Unix epoch. */
  const EXCEL_EPOCH_OFFSET = 25569;
  const MS_PER_DAY = 86400000;
  const SHEET_TAG = /<sheet\s[^>]*\/?>/g;
  const RELATIONSHIP_TAG = /<Relationship\s[^>]*\/?>/g;
  const SHARED_ITEM = /<si>([\s\S]*?)<\/si>/g;
  const TEXT_RUN = /<t[^>]*>([\s\S]*?)<\/t>/g;
  // The leading whitespace stays inside the capture so the attribute patterns,
  // which all anchor on a preceding space, match the first attribute too.
  const CELL = /<c(\s[^>]*?)\/>|<c(\s[^>]*?)>([\s\S]*?)<\/c>/g;
  const VALUE = /<v[^>]*>([\s\S]*?)<\/v>/;
  const ENTITY = /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|(amp|lt|gt|quot|apos));/g;
  const NAMED_ENTITIES = new Map([
    ["amp", "&"],
    ["lt", "<"],
    ["gt", ">"],
    ["quot", '"'],
    ["apos", "'"],
  ]);

  /**
   * Decode the XML entities Excel emits inside attributes and text nodes.
   * @param {string} text - Raw XML text content.
   * @returns {string} Decoded text.
   */
  function decodeEntities(text) {
    if (!text.includes("&")) return text;
    return text.replace(ENTITY, (match, decimal, hex, named) => {
      if (decimal) return String.fromCodePoint(Number(decimal));
      if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
      return NAMED_ENTITIES.get(named);
    });
  }

  /**
   * Read one attribute out of a raw start tag.
   *
   * OOXML parts are scanned as text rather than parsed into a DOM: Excel emits
   * one tightly-constrained shape per part, and building DOM trees for every
   * worksheet of a large workbook is prohibitively memory-hungry.
   * @param {string} tag - The raw start tag.
   * @param {RegExp} pattern - Attribute pattern with a single capture group.
   * @returns {string|null} Decoded attribute value, or null when absent.
   */
  function readAttribute(tag, pattern) {
    const match = tag.match(pattern);
    return match ? decodeEntities(match[1]) : null;
  }

  /**
   * Concatenate every text run inside an XML fragment.
   * @param {string} fragment - XML fragment containing `<t>` elements.
   * @returns {string} Combined decoded text.
   */
  function readTextRuns(fragment) {
    let combined = "";
    for (const run of fragment.matchAll(TEXT_RUN)) combined += decodeEntities(run[1]);
    return combined;
  }

  /**
   * Quote a sheet name the way `excel_source` mapping entries do.
   * @param {string} sheetName - Worksheet name.
   * @param {string} cell - Cell reference (e.g. `K5`).
   * @returns {string} Mapping-style source key (e.g. `'CV1 (2)'!K5`).
   */
  function formatSource(sheetName, cell) {
    return `'${sheetName}'!${cell}`;
  }

  /**
   * Read shared strings, resolving each entry's concatenated text runs.
   * @param {ArrayBuffer} buffer - Raw archive bytes.
   * @param {Map<string, Object>} entries - Central directory entries.
   * @returns {string[]} Shared string table.
   */
  function readSharedStrings(buffer, entries) {
    const entry = entries.get("xl/sharedStrings.xml");
    if (!entry) return [];

    const xml = readEntryText(buffer, entry);
    return [...xml.matchAll(SHARED_ITEM)].map((item) => readTextRuns(item[1]));
  }

  /**
   * Resolve worksheet names to their part paths inside the archive.
   * @param {ArrayBuffer} buffer - Raw archive bytes.
   * @param {Map<string, Object>} entries - Central directory entries.
   * @returns {Map<string, string>} Sheet name to archive path.
   */
  function readSheetIndex(buffer, entries) {
    const relsXml = readEntryText(buffer, entries.get("xl/_rels/workbook.xml.rels"));
    const targets = new Map(
      [...relsXml.matchAll(RELATIONSHIP_TAG)].map((tag) => [
        readAttribute(tag[0], ID_ATTR),
        readAttribute(tag[0], TARGET_ATTR).replace(/^\/?(xl\/)?/, ""),
      ]),
    );

    const workbookXml = readEntryText(buffer, entries.get("xl/workbook.xml"));
    return new Map(
      [...workbookXml.matchAll(SHEET_TAG)].map((tag) => [
        readAttribute(tag[0], NAME_ATTR),
        `xl/${targets.get(readAttribute(tag[0], RID_ATTR))}`,
      ]),
    );
  }

  /**
   * Count the decimal places a custom number-format code displays.
   *
   * Only plain fixed-decimal codes qualify. A code that rescales or
   * restructures its value -- percent, scientific, or fraction -- is rejected,
   * because rounding alone would not reproduce what Excel shows.
   * @param {string} code - Raw `formatCode` attribute.
   * @returns {number|null} Decimal places, or null when the code is not a plain number.
   */
  function decimalPlaces(code) {
    // Only the positive section applies to the values these reports carry, and
    // literal text and locale qualifiers never affect the displayed precision.
    const positive = code.split(";").at(0)
      .replace(/\[[^\]]*\]/g, "")
      .replace(/"[^"]*"/g, "");
    if (!/[0#]/.test(positive)) return null;
    if (/[%eE/]/.test(positive) || /[dmyhs]/i.test(positive)) return null;
    const fraction = positive.match(/\.([0#]+)/);
    return fraction ? fraction[1].length : 0;
  }

  /**
   * Identify how each cell style displays its value, so cells render the way
   * Excel shows them instead of exposing raw serials and cached floats.
   *
   * Dates become `DD/MM/YYYY`, and fixed-decimal formats keep their displayed
   * precision -- a cached `34.9041486172` shown as `34.9` in a `0.0` cell must
   * reach the PDF as `34.9`, because the renderers draw these values verbatim.
   * @param {ArrayBuffer} buffer - Raw archive bytes.
   * @param {Map<string, Object>} entries - Central directory entries.
   * @returns {{dateStyles: Set<number>, decimalStyles: Map<number, number>}} Style lookups.
   */
  function readCellStyles(buffer, entries) {
    const dateStyles = new Set();
    const decimalStyles = new Map();
    const entry = entries.get("xl/styles.xml");
    if (!entry) return { dateStyles, decimalStyles };

    const xml = readEntryText(buffer, entry);

    // Custom formats declare a date by using day/month/year tokens in their
    // code; literal text and locale qualifiers are stripped before testing.
    const customDateFormats = new Set();
    const customDecimalFormats = new Map();
    for (const tag of xml.matchAll(NUMFMT_TAG)) {
      const rawCode = readAttribute(tag[0], FORMATCODE_ATTR) ?? "";
      const numFmtId = Number(readAttribute(tag[0], NUMFMTID_ATTR));
      const code = rawCode.replace(/\[[^\]]*\]/g, "").replace(/"[^"]*"/g, "");
      if (/[dmy]/i.test(code)) {
        customDateFormats.add(numFmtId);
        continue;
      }
      const decimals = decimalPlaces(rawCode);
      if (decimals !== null) customDecimalFormats.set(numFmtId, decimals);
    }

    const cellXfs = xml.match(CELLXFS_BLOCK);
    if (!cellXfs) return { dateStyles, decimalStyles };

    [...cellXfs[1].matchAll(XF_TAG)].forEach((tag, styleIndex) => {
      const numFmtId = Number(readAttribute(tag[0], NUMFMTID_ATTR));
      if (BUILT_IN_DATE_FORMATS.has(numFmtId) || customDateFormats.has(numFmtId)) {
        dateStyles.add(styleIndex);
        return;
      }
      const decimals = customDecimalFormats.has(numFmtId)
        ? customDecimalFormats.get(numFmtId)
        : BUILT_IN_DECIMAL_FORMATS.get(numFmtId);
      if (decimals !== undefined) decimalStyles.set(styleIndex, decimals);
    });
    return { dateStyles, decimalStyles };
  }

  /**
   * Resolve a relationship target against the part that declares it.
   * @param {string} basePath - Path of the part holding the relationship.
   * @param {string} target - Raw `Target` attribute.
   * @returns {string} Archive path of the referenced part.
   */
  function resolvePartPath(basePath, target) {
    if (target.startsWith("/")) return target.slice(1);
    const segments = basePath.split("/").slice(0, -1);
    for (const part of target.split("/")) {
      if (part === "..") segments.pop();
      else if (part !== "." && part !== "") segments.push(part);
    }
    return segments.join("/");
  }

  /**
   * Map a part's relationship ids onto their resolved archive paths.
   * @param {ArrayBuffer} buffer - Raw archive bytes.
   * @param {Map<string, Object>} entries - Central directory entries.
   * @param {string} partPath - Path of the part whose relationships are read.
   * @returns {Map<string, string>} Relationship id to archive path.
   */
  function readPartRelationships(buffer, entries, partPath) {
    const segments = partPath.split("/");
    const fileName = segments.pop();
    const relsPath = [...segments, "_rels", `${fileName}.rels`].join("/");
    const entry = entries.get(relsPath);
    if (!entry) return new Map();

    return new Map(
      [...readEntryText(buffer, entry).matchAll(RELATIONSHIP_TAG)].map((tag) => [
        readAttribute(tag[0], ID_ATTR),
        resolvePartPath(partPath, readAttribute(tag[0], TARGET_ATTR) ?? ""),
      ]),
    );
  }

  /**
   * Media types pdf-lib can embed. Anything else is skipped rather than
   * handed to a renderer that cannot draw it.
   * @param {string} path - Archive path of the picture.
   * @returns {string|null} MIME type, or null when unsupported.
   */
  function pictureMediaType(path) {
    const extension = path.split(".").at(-1)?.toLowerCase();
    if (extension === "png") return "image/png";
    if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
    return null;
  }

  /**
   * Read every picture anchored on one worksheet, with the cell it sits on.
   *
   * Reports carry their signatures and appendix photographs as embedded
   * pictures rather than cell values, and `src/report-mapping.js` locates them
   * by anchor row and column, so both are reported here. Anchor coordinates
   * are the zero-based `<from>` values exactly as OOXML stores them.
   * @param {ArrayBuffer} buffer - Raw archive bytes.
   * @param {Map<string, Object>} entries - Central directory entries.
   * @param {string} sheetPath - Archive path of the worksheet part.
   * @param {Map<string, Uint8Array>} mediaCache - Decompressed pictures by path.
   * @returns {Array<{name: string, row: number, column: number, mimeType: string, bytes: Uint8Array}>} Anchored pictures.
   */
  function readSheetImages(buffer, entries, sheetPath, mediaCache) {
    const drawingPath = [...readPartRelationships(buffer, entries, sheetPath).values()]
      .find((path) => path.includes("/drawings/") && path.endsWith(".xml"));
    const drawingEntry = drawingPath ? entries.get(drawingPath) : undefined;
    if (!drawingEntry) return [];

    const media = readPartRelationships(buffer, entries, drawingPath);
    const xml = readEntryText(buffer, drawingEntry);
    const images = [];

    // Each anchor holds its `<from>` cell before any `<to>` cell, so the first
    // column and row inside the chunk are the picture's own anchor.
    for (const chunk of xml.split(ANCHOR_SPLIT).slice(1)) {
      const relationshipId = chunk.match(BLIP_EMBED)?.[1];
      const mediaPath = relationshipId ? media.get(relationshipId) : undefined;
      const mimeType = mediaPath ? pictureMediaType(mediaPath) : null;
      const mediaEntry = mediaPath ? entries.get(mediaPath) : undefined;
      if (!mimeType || !mediaEntry) continue;

      // One picture is commonly anchored on several sheets; inflate it once.
      if (!mediaCache.has(mediaPath)) {
        mediaCache.set(mediaPath, readEntryBytes(buffer, mediaEntry));
      }

      images.push({
        name: chunk.match(PICTURE_NAME)?.[1] ?? "Workbook image",
        row: Number(chunk.match(ANCHOR_ROW)?.[1] ?? -1),
        column: Number(chunk.match(ANCHOR_COLUMN)?.[1] ?? -1),
        mimeType,
        bytes: mediaCache.get(mediaPath),
      });
    }
    return images;
  }

  /**
   * Render an Excel date serial as a `DD/MM/YYYY` string.
   * @param {number} serial - Excel date serial number.
   * @returns {string} Formatted date.
   */
  function formatExcelDate(serial) {
    const date = new Date(Math.round((serial - EXCEL_EPOCH_OFFSET) * MS_PER_DAY));
    const day = String(date.getUTCDate()).padStart(2, "0");
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    return `${day}/${month}/${date.getUTCFullYear()}`;
  }

  /**
   * Drop the binary floating-point noise Excel caches in worksheet values, so
   * `63.099999999999994` reads as `63.1` without inventing precision.
   * @param {string} text - Raw cached cell value.
   * @returns {string} Cleaned numeric text.
   */
  function normalizeNumber(text) {
    const value = Number(text);
    if (!Number.isFinite(value)) return text;
    return String(Number(value.toPrecision(12)));
  }

  /**
   * Render a cached number with the decimal places its cell format displays.
   *
   * Excel rounds the decimal value half away from zero, while `toFixed` rounds
   * the underlying binary double: `20.15` displays as `20.2` in a `0.0` cell
   * but `toFixed(1)` yields `20.1`. Shifting the decimal exponent through the
   * number's own string form reproduces Excel's result.
   * @param {string} text - Raw cached cell value.
   * @param {number} decimals - Decimal places from the cell's number format.
   * @returns {string} Excel's displayed value.
   */
  function formatDecimal(text, decimals) {
    const value = Number(text);
    if (!Number.isFinite(value)) return text;

    const magnitude = Math.abs(value);
    // Exponential string forms cannot carry a shifted exponent, and at that
    // scale the binary rounding difference is not representable anyway.
    if (String(magnitude).includes("e")) return value.toFixed(decimals);

    const rounded = Math.round(Number(`${magnitude}e${decimals}`));
    return ((value < 0 ? -1 : 1) * Number(`${rounded}e-${decimals}`)).toFixed(decimals);
  }

  /**
   * Read every non-empty cell of one worksheet into the shared lookup.
   * @param {string} xml - Worksheet XML.
   * @param {string} sheetName - Worksheet name.
   * @param {string[]} sharedStrings - Shared string table.
   * @param {Map<string, string>} lookup - Destination cell lookup, mutated in place.
   * @returns {void}
   */
  function collectCells(xml, sheetName, sharedStrings, lookup, sheetLookup, styles) {
    for (const match of xml.matchAll(CELL)) {
      // Self-closing `<c r="A1"/>` cells carry styling only and hold no value.
      const body = match[3];
      if (body === undefined) continue;

      const tag = match[2];
      const value = body.match(VALUE);
      const type = readAttribute(tag, TYPE_ATTR);
      let text = "";

      if (type === "s" && value) {
        text = sharedStrings.at(Number(decodeEntities(value[1]))) ?? "";
      } else if (body.includes("<is>")) {
        text = readTextRuns(body);
      } else if (value) {
        text = decodeEntities(value[1]);
      }

      let trimmed = text.trim();
      if (trimmed === "") continue;

      // Untyped cells hold numbers, displayed the way their style formats
      // them: dates as dates, fixed-decimal cells at their shown precision.
      if (value && (!type || type === "n")) {
        const numeric = Number(trimmed);
        if (Number.isFinite(numeric)) {
          const styleIndex = Number(readAttribute(tag, STYLE_ATTR));
          if (styles.dateStyles.has(styleIndex)) {
            trimmed = formatExcelDate(numeric);
          } else if (styles.decimalStyles.has(styleIndex)) {
            trimmed = formatDecimal(trimmed, styles.decimalStyles.get(styleIndex));
          } else {
            trimmed = normalizeNumber(trimmed);
          }
        }
      }

      const ref = readAttribute(tag, REF_ATTR);
      lookup.set(formatSource(sheetName, ref), trimmed);
      sheetLookup.set(ref, trimmed);
    }
  }

  /**
   * Convert a spreadsheet column label into a zero-based index (`A` -> 0, `AA` -> 26).
   * @param {string} label - Column letters.
   * @returns {number} Zero-based column index.
   */
  function columnIndex(label) {
    let index = 0;
    for (const character of label) index = index * 26 + (character.charCodeAt(0) - 64);
    return index - 1;
  }

  /**
   * Reshape one worksheet's cells into a dense row/column grid, keeping only the
   * columns that actually carry data so exported tables stay readable.
   * @param {Map<string, string>} sheetCells - Cell values keyed by reference (e.g. `K5`).
   * @returns {{columns: string[], rows: Array<string[]>}} Grid ready for rendering.
   */
  function toGrid(sheetCells) {
    const parsed = [];
    const usedColumns = new Set();

    sheetCells.forEach((value, ref) => {
      const match = ref.match(/^([A-Z]+)(\d+)$/);
      if (!match) return;
      const column = columnIndex(match[1]);
      usedColumns.add(column);
      parsed.push({ column, row: Number(match[2]), value });
    });

    const columns = [...usedColumns].sort((a, b) => a - b);
    const columnSlot = new Map(columns.map((column, slot) => [column, slot]));
    const rowNumbers = [...new Set(parsed.map((cell) => cell.row))].sort((a, b) => a - b);
    const rowSlot = new Map(rowNumbers.map((row, slot) => [row, slot]));

    const rows = rowNumbers.map(() => new Array(columns.length).fill(""));
    parsed.forEach((cell) => {
      rows[rowSlot.get(cell.row)][columnSlot.get(cell.column)] = cell.value;
    });

    return {
      columns: columns.map((column) => columnLabel(column)),
      rows,
    };
  }

  /**
   * Convert a zero-based column index back into its spreadsheet label.
   * @param {number} index - Zero-based column index.
   * @returns {string} Column letters.
   */
  function columnLabel(index) {
    let label = "";
    let remaining = index;
    do {
      label = String.fromCharCode(65 + (remaining % 26)) + label;
      remaining = Math.floor(remaining / 26) - 1;
    } while (remaining >= 0);
    return label;
  }

  /**
   * Split a grouped sheet name into its prefix and group suffix.
   * Excel's "duplicate sheet" naming leaves inconsistent whitespace
   * (`DS1  (2)`), so the prefix is compared with whitespace collapsed.
   * @param {string} sheetName - Worksheet name.
   * @returns {{prefix: string, group: number}|null} Parsed parts, or null when unrecognised.
   */
  function parseSheetName(sheetName) {
    const suffixStart = sheetName.indexOf("(");
    const head = suffixStart === -1 ? sheetName : sheetName.slice(0, suffixStart);
    const prefix = head.replace(/\s+/g, "");
    if (!GROUP_SHEET_PREFIXES.includes(prefix)) return null;

    if (suffixStart === -1) return { prefix, group: 1 };

    const suffix = sheetName.slice(suffixStart).match(/^\((\d+)\)$/);
    return suffix ? { prefix, group: Number(suffix[1]) } : null;
  }

  /**
   * Detect the complete test-report groups present in a workbook. Each group is
   * one `CV1`/`TR1`/`DS1`/`SB1` sheet set, so a six-sample workbook reports six
   * groups. Groups missing any constituent sheet are excluded.
   * @param {string[]} sheetNames - All worksheet names in the workbook.
   * @returns {Array<{group: number, sheets: Record<string, string>}>} Ordered complete groups.
   */
  function detectReportGroups(sheetNames) {
    const grouped = new Map();
    sheetNames.forEach((sheetName) => {
      const parsed = parseSheetName(sheetName);
      if (!parsed) return;
      if (!grouped.has(parsed.group)) grouped.set(parsed.group, new Map());
      grouped.get(parsed.group).set(parsed.prefix, sheetName);
    });

    return [...grouped.entries()]
      .filter(([, sheets]) => GROUP_SHEET_PREFIXES.every((prefix) => sheets.has(prefix)))
      .sort((a, b) => a[0] - b[0])
      .map(([group, sheets]) => ({ group, sheets: Object.fromEntries(sheets) }));
  }

  /**
   * Extract the identifying fields of one report group using logical keys.
   * @param {Map<string, string>} cells - Workbook cell lookup.
   * @param {{sheets: Record<string, string>}} reportGroup - A detected report group.
   * @returns {Record<string, string>} Identity values keyed by logical key.
   */
  function extractReportIdentity(cells, reportGroup) {
    const identity = {};
    IDENTITY_FIELDS.forEach((field) => {
      const sheetName = reportGroup.sheets[String(field.sheet)];
      const value = sheetName ? cells.get(formatSource(sheetName, field.cell)) : undefined;
      if (value !== undefined) identity[String(field.key)] = value;
    });
    return identity;
  }

  /**
   * Read an uploaded workbook into sheet names and a mapping-style cell lookup.
   * @param {Blob} file - The uploaded `.xlsx` file.
   * @returns {Promise<{sheetNames: string[], cells: Map<string, string>, reportGroups: Array<Object>}>} Parsed workbook.
   * @throws {Error} When the file is not a readable OOXML workbook.
   */
  async function readWorkbook(file) {
    const buffer = await file.arrayBuffer();
    const entries = readCentralDirectory(buffer);
    if (!entries.has("xl/workbook.xml")) {
      throw new Error("Workbook is missing its xl/workbook.xml part.");
    }

    const sharedStrings = readSharedStrings(buffer, entries);
    const styles = readCellStyles(buffer, entries);
    const sheetIndex = readSheetIndex(buffer, entries);
    const cells = new Map();
    const sheets = new Map();
    const images = new Map();
    const mediaCache = new Map();

    for (const [sheetName, path] of sheetIndex) {
      const entry = entries.get(path);
      if (!entry) continue;
      images.set(sheetName, readSheetImages(buffer, entries, path, mediaCache));
      const sheetLookup = new Map();
      collectCells(
        readEntryText(buffer, entry),
        sheetName,
        sharedStrings,
        cells,
        sheetLookup,
        styles,
      );
      sheets.set(sheetName, sheetLookup);
    }

    const sheetNames = [...sheetIndex.keys()];
    return { sheetNames, cells, sheets, images, reportGroups: detectReportGroups(sheetNames) };
  }

  globalThis.docuAlignXlsx = Object.freeze({
    GROUP_SHEET_PREFIXES,
    IDENTITY_FIELDS,
    columnLabel,
    decimalPlaces,
    detectReportGroups,
    extractReportIdentity,
    formatDecimal,
    formatExcelDate,
    formatSource,
    inflateRaw,
    normalizeNumber,
    readWorkbook,
    toGrid,
  });
})();
