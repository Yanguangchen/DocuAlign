# Test Report and Summary Export: Root Cause, Fix, and Verification

This document records a defect found in production, its root cause, the fix,
and the verification performed — including a detailed investigation of a
"missing grid lines" report that turned out to be a false alarm. It exists so
future changes to the export pipeline don't reintroduce the same regression.

## 1. Symptom

Every exported `CV1` + `TR1` test report PDF was identical regardless of which
workbook was uploaded — same client, same job references, same results. Only
the downloaded file's *name* varied, because that came from the uploaded
workbook's job reference cell.

## 2. Root cause

`src/workspace.js` planned every test report document with:

```js
assetPath: REPORT_ASSET_PATH, // "./SampleDocuments/SampleOutput.pdf"
sheets: [],
```

`downloadDocument` treats a plan with an `assetPath` as **not generated**
(`isGenerated = !plan.assetPath`) and serves that static file directly. Every
export was therefore the bundled sample PDF, byte-for-byte, no matter what was
uploaded.

The code that *should* have filled the report in from a workbook already
existed and was fully tested:

- `src/report-mapping.js` — maps each `CV1`/`TR1`/`DS1`/`SB1` worksheet group
  into a semantic report model (client, job ref, PSD rows, shear results and
  series, silt/coral, moisture, organic matter, 12 metals).
- `src/rak-report-pdf.js` — copies the five reference PDF pages and overlays
  a report model's values at coordinates measured from that reference,
  preserving the approved layout exactly.

Neither module was loaded by any page. `git log -S rak-report-pdf.js` traces
this to commit `467d7d3`, where a merge conflict in `index.html` was resolved
by keeping one side of the conflict and discarding the other:

```diff
-<<<<<<< HEAD
-    <script src="./src/workbook-pdf.js"></script>
-    <script src="./src/report-mapping.js"></script>
-    <script src="./src/rak-report-pdf.js"></script>
-=======
     <script src="./src/xlsx-reader.js"></script>
     <script src="./src/pdf-writer.js"></script>
->>>>>>> 5d5b9f2 (Add behavioral tests for XLSX reader functionality)
```

`src/workspace.js` was rewritten in the same commit to serve the static asset
instead, and the app shipped that way from then on.

## 3. Fix

1. `report-mapping.js` and `rak-report-pdf.js` are loaded again as classic
   scripts in `index.html`, `view.html` (for the public share viewer), and
   `vite.config.js`'s `classicScripts` list.
2. `src/workspace.js` adapts the dependency-free reader's per-sheet
   `Map<string, string>` cell lookups into the plain-object-with-`images: []`
   shape `report-mapping.js` expects (`toMappingWorkbook`), maps every group
   once per pipeline run (`mapReportModels`), and plans each report with
   `renderer: "report"` when a model exists for its group.
3. `renderDocument` calls `docuAlignRakReportPdf.createRakReportPdf([model])`
   for those documents instead of serving the asset.
4. **Fallback, not the normal path:** a workbook whose groups the mapper
   rejects (thrown error) still serves the reference asset for that report,
   logged via `logWarn`, so an unexpected workbook shape degrades gracefully
   instead of failing the whole export.
5. Saved/shared reports publish their mapped model as `documentData`
   (`{renderer: "report", report: {...}}`, ~7 KB per report, well inside the
   100,000-character share bound) instead of `null`, and
   `src/view-report.js`'s `resolveDocumentUrl` rebuilds the PDF the same way,
   so dashboard shares and package links carry the uploaded data too.

Two secondary defects surfaced during this work and were fixed alongside it:

- **Cached-float display bug** (`src/xlsx-reader.js`): cells were exposed with
  their raw cached double (e.g. `34.9041486172`) instead of what Excel
  displays (`35`, in a `0` cell). The renderers draw values verbatim, so this
  reached the PDF. Fixed by resolving each cell's number format from
  `xl/styles.xml` (`readCellStyles`, `decimalPlaces`, `formatDecimal`) and
  rounding half-away-from-zero as Excel does (`toFixed` alone rounds the
  underlying binary double and gets values like `20.15` wrong). Verified
  against `SampleInput.xlsx`: 5,861 of 5,862 non-blank cells now match
  Excel's displayed value exactly; the one remaining difference is the
  repo's deliberate `DD/MM/YYYY` date convention.
- **Summary row cap** (`src/summary-pdf.js`): `buildOverlayPlan` scanned only
  worksheet rows 18–27 (the reference workbook's exact row count), silently
  dropping any samples beyond row 27. Replaced with `lastResultRow`, which
  scans the actual cell data for the last populated row.
- **Signature erasure guard** (`src/rak-report-pdf.js`): the overlay's image
  loop unconditionally whited out the signature and appendix-photo regions
  even when there was no replacement image to draw. Fixed by skipping the
  whiteout+draw entirely when `image.asset?.bytes` is absent, so the
  reference pages' own artwork survives when a workbook supplies none.

## 3a. Embedded pictures (second phase)

The first phase fixed the *text* half of the report only. Signatures and
appendix photographs are embedded pictures, not cell values, and
`xlsx-reader.js` parsed cell values exclusively — it never opened
`xl/drawings/` or `xl/media/`. Every exported report therefore carried the
**reference sample's photographs**, verified as a zero-pixel difference
between the template's and every generated report's appendix photo boxes.
For a lab report that is misattributed evidence: one cargo hold's report
showing another sample's photographs.

`src/xlsx-reader.js` now extracts them:

- `readEntryBytes` returns raw entry bytes (`readEntryText` decodes on top of
  it). **Stored entries are copied, not returned as a view onto the archive
  buffer** — pdf-lib's image embedders read `.buffer` directly and ignore a
  view's `byteOffset`, which produced `SOI not found in JPEG` until fixed.
  Excel stores already-compressed pictures with method 0, so every photograph
  hit this path.
- `readSheetImages` follows worksheet → `xl/drawings/drawingN.xml` →
  drawing rels → `xl/media/*`, reading each anchor's zero-based `<from>`
  row/column exactly as `src/report-mapping.js` expects (photos anchor at
  `row >= 147, column === 5`; signatures at rows 129–131). Pictures anchored
  on several sheets are inflated once via a media cache, and media types
  pdf-lib cannot embed are skipped.
- Drawing parts namespace their elements with a per-file prefix, so the
  patterns anchor on `[:<]` before each local name. This keeps every
  quantifier flat — the earlier `(?:[a-z]+:)?` form nested a quantifier
  inside an optional group and tripped `security/detect-unsafe-regex`.
- `readWorkbook` returns `images` (a `Map` of sheet name to picture list) and
  `toMappingWorkbook` in `src/workspace.js` passes it straight through.

**Share payload bound.** Passing real pictures pushed `documentData` to
4,044,098 characters — 40× the 100,000 bound the Firestore rules enforce.
`withoutPictureBytes` therefore strips picture bytes from the published
payload, keeping name/anchor/MIME metadata, which returns it to ~7 KB. The
downloaded report renders from the in-memory model and has full artwork; a
share rebuilt by the public viewer keeps the reference pages' artwork.
**This is a known remaining gap** — shared/public copies still show the
reference photographs. Closing it needs the pictures hosted (for example
Firebase Storage) and referenced by URL, which is a product decision, not a
code cleanup.

## 4. Verification performed

- **Per-report data isolation.** Rendered all six groups of
  `SampleDocuments/SampleInput.xlsx` through the real mapping and overlay
  code (no mocks). Each output PDF is 5 pages, and drawn-text extraction from
  the content streams confirms each carries its own job reference
  (`X-2026-522-1` … `-6`) and cargo hold (`2-C`, `3-A`, `3-D`, `4-A`, `4-D`,
  `5-B`) with no cross-contamination between groups — a regression to the
  static-asset bug would show all six as identical.
- **Format preservation.** Compared each generated report's page geometry and
  content streams against the untouched `SampleOutput.pdf`: identical page
  count (5) and page size (595.2×841.68pt) on every page, and the
  reference's own content stream is carried over byte-for-byte on every page
  (same length, same bytes) — confirming the layout is copied, not
  recomputed. Only the overlay streams (whiteouts + new text) are added.
- **Number formatting.** Compared all 5,862 non-blank cells of
  `SampleInput.xlsx` between the dependency-free reader and SheetJS's
  displayed (`.w`) values; 1 mismatch (the deliberate date format choice).
- **Embedded pictures.** After extraction, the appendix photo boxes differ
  between every pair of groups (millions of pixels of difference where the
  measurement was previously exactly `0`), and each report's photographed
  sample-bag label matches that report's own cargo hold (`2-C`, `3-D`, …) —
  an independent check that pictures are matched to the right group, not
  merely different from each other. Group 2 still matches the template
  exactly, which is correct: `SampleOutput.pdf` *is* group 2's report.
- **Charts.** The grading curve and both shear charts are whited out and
  replotted from `report.psd.rows`, `directShear.rows`, and
  `directShear.series`; their rendered regions differ between groups and from
  the template, so no chart is inherited from the reference.
- **Test suite.** `npm test`: 325 passed, 24 skipped (Firestore emulator
  tests, gated on `RUN_FIRESTORE_RULE_TESTS`). `npm run lint`: zero warnings.
  `npm run coverage`: 100% statements/branches/functions/lines on `src/**`.

## 5. The "missing grid lines" investigation

A screenshot of an exported Summary PDF was reported to have missing table
grid lines. This section records how that claim was checked and why it did
not hold up, so the same false alarm isn't rediscovered from scratch.

**Method:** rendered both the untouched reference (`sample_summary.pdf`) and
a freshly generated Summary (same client/job ref/6 result rows as the
screenshot) to raster images at matching scale with `pypdfium2`, then
diffed dark ("ink") pixels between the two images.

**First pass (misleading):** a naive per-pixel, per-row comparison flagged
several full-width horizontal rules as "97% missing" in the generated image —
specifically the exact row-separator lines `drawResultBody` draws, spaced at
precisely the expected `BODY_ROW_HEIGHT` pitch. This looked like a real and
serious bug.

**Second pass (root cause of the false alarm):** annotating the suspect pixel
rows directly onto the generated image and viewing the surrounding area
showed the lines were visibly present, just offset by roughly 1–2 pixels from
where the naive diff sampled. Re-running the pixel comparison with a ±2px
vertical tolerance (to absorb this offset) found **zero** missing full-width
rules. The offset itself comes from the two files being independently-built
PDFs — the reference is untouched, hand-authored bytes, while the generated
file is a new document that pdf-lib assembles by copying the reference page
and adding overlay streams. That reassembly can shift anti-aliased line edges
by a sub-pixel amount without changing the underlying vector geometry at all.
This is a rendering/comparison artifact, not a defect in the exported PDF.

**Conclusion:** for the exact dataset in the reported screenshot, the
Summary's table grid is complete: every reference rule has a corresponding
line in the generated output once sub-pixel rasterization differences are
accounted for. No code change was made for this report. If grid lines are
still visibly missing in a real render, get a specific row/column pointer (or
the exact generated PDF) rather than re-deriving this from a screenshot alone
— the failure mode above shows how easy it is to mistake a 1px rasterization
offset for missing content.

## 6. What to check before touching this again

- Never let `assetPath` be the default for a report plan — it must only be
  set in the explicit fallback branch of `planExportDocuments` when
  `mappedReports` has no model for that group. `src/pdf-export.test.js`
  locks in that `docuAlignRakReportPdf.createRakReportPdf` is the normal
  path and `document.assetPath = REPORT_ASSET_PATH` only appears as a
  fallback assignment.
- Any renderer that draws mapped values verbatim (report or Summary) is only
  as correct as `xlsx-reader.js`'s number formatting. If a value looks like a
  raw float in output, suspect a missing or misclassified number format in
  `xl/styles.xml` before suspecting the renderer.
- `report-mapping.js` and `rak-report-pdf.js` must stay classic scripts (no
  `import`/`export`) and stay listed in `classicScripts` in `vite.config.js`
  and loaded via `<script vite-ignore>` in both `index.html` and `view.html`
  — losing either is exactly how this regression happened the first time.
