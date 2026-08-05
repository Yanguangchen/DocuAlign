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

**Conclusion at the time:** for the exact dataset in that screenshot, the
*horizontal* rules were all present once sub-pixel rasterization differences
were accounted for, and no code change was made.

> [!WARNING]
> **That conclusion was too broad, and later reports proved it wrong.** The
> ±2px-tolerance pass answered only "is each reference rule present *somewhere*
> nearby", which is why two real defects survived it — uneven rule *weight*
> (§7) and erased *vertical* rules (§8). The lesson is not "grid complaints are
> false alarms": it is that whole-page ink diffing between two independently
> built PDFs is too noisy to settle this question. Both real defects were found
> instead by measuring specific geometry — rule thickness in points, and ink
> coverage sampled at each of the 27 known rule x-positions. Reach for a
> targeted measurement, not a whole-page diff, and treat a reported grid
> problem as real until a targeted measurement says otherwise.

## 7. Uneven rule weight in the result body

The finished table showed rules of visibly different weights. Three causes,
all in the redrawn result body:

- The body grid **stroked 0.72pt lines** while every rule the reference page
  draws is a **0.84pt filled rectangle**.
- The body mask stopped at `BODY_TOP` (352.1) but the reference's top body
  rule spans 352.03–352.87, so a 0.77pt sliver survived *underneath* the
  redrawn rule and rendered it about 1.13pt thick.
- `TABLE_BOUNDARIES`, which positioned cell text, sits up to 1.2pt left of
  the rules the reference actually draws, so body verticals jogged against
  the header's.

Rules are now filled rectangles at the measured reference geometry
(`TABLE_RULE_X`, `BODY_TOP_RULE`, `RULE_THICKNESS`), and the mask clears the
reference's top rule completely. Measured on a four-row workbook, body rule
weights went from `0.88, 0.75, 0.75, 0.75, 0.62` pt to a uniform `0.88` pt.

## 8. Erased vertical rules in the two header rows

Sampling ink coverage at each of the 27 rule positions showed the sieve-size
header row missing columns 3–9 and the limits row missing columns 3–10 — 2–3%
of each rule remaining where the reference has 100%.

Same root cause as §7, in the one place that fix did not reach. Both header
rows are masked cell by cell before their values are redrawn, and those masks
were positioned from `TABLE_BOUNDARIES` — the *text* boundaries — so each mask
began left of its own cell's opening rule and painted over it. The body
survived only because it redraws its rules afterwards; these rows never do, so
the lines were gone for good. The boundary drift shrinks from 1.19pt at the
left of the table to 0.14pt at the right, which is exactly why the left-hand
columns vanished and the right-hand ones survived.

Masks and values are now bounded by `cellInterior()`, the span between a
cell's two rules. `TABLE_BOUNDARIES` is deleted outright: the rule geometry is
the single source of truth for drawing *and* text placement. A regression test
asserts no header mask ever horizontally overlaps a rule.

## 9. The last static report

Auditing all six reports for static content found one still served as the
bundled asset. `createRakReportPdf` short-circuited any report whose mapped
data and pictures hashed equal to the reference sample: its five pages were
copied from `SampleOutput.pdf` untouched, with no overlay. For the sample
workbook that is group 2 — the report `SampleOutput.pdf` was produced from —
so one report in every export carried the bundled PDF's photographs, values
and typography, and stayed in the reference's original typography while the
other five were redrawn.

Byte-level checking caught it: group 2's own workbook photographs were absent
from its PDF while the other five embedded theirs. Every report is now
overlaid from its own mapped values, and the reference-hashing helpers
(`matchesReferenceReport`, `reportDataHash`, `stringHash`, `byteHash`) are
removed with the branch they served.

**Audit method worth reusing:** resolve each group's photographs straight out
of the workbook (worksheet → drawing → media relationships), hash them, and
assert those exact bytes appear in the generated PDF. Pixel comparison alone
would have accepted group 2, because its static pages *looked* correct — they
are that group's own report.

## 10. One link per report

Publishing a public link required ticking each document into a package first.
The report card's own button now publishes the report's whole document set as
a single package link and says how many documents it carries; reports saved
before per-document storage still publish as a plain share. The package
checkboxes remain for the narrower job of mixing documents across reports. A
package over `MAX_BUNDLE_REPORTS` (25) surfaces that reason rather than
inviting a retry that cannot succeed.

Two consequences to keep in mind: a recipient now sees every document in a
report rather than only what was ticked, and re-enabling the DS1/SB1 and
standalone-worksheet exports takes a workbook from 7 documents back to 20+,
which will approach that 25-document ceiling.

## 11. What to check before touching this again

- Never let `assetPath` be the default for a report plan — it must only be
  set in the explicit fallback branch of `planExportDocuments` when
  `mappedReports` has no model for that group. `src/pdf-export.test.js`
  locks in that `docuAlignRakReportPdf.createRakReportPdf` is the normal
  path and `document.assetPath = REPORT_ASSET_PATH` only appears as a
  fallback assignment.
- Never reintroduce a "this report equals the reference, copy it untouched"
  short-circuit (§9). It looks like a harmless optimisation and silently puts
  one static report into every export.
- Anything that paints over a table cell must be bounded by `cellInterior()`,
  never by a text-boundary array (§8). A mask that is a point too wide erases
  a rule that nothing redraws.
- Any renderer that draws mapped values verbatim (report or Summary) is only
  as correct as `xlsx-reader.js`'s number formatting. If a value looks like a
  raw float in output, suspect a missing or misclassified number format in
  `xl/styles.xml` before suspecting the renderer.
- `report-mapping.js` and `rak-report-pdf.js` must stay classic scripts (no
  `import`/`export`) and stay listed in `classicScripts` in `vite.config.js`
  and loaded via `<script vite-ignore>` in both `index.html` and `view.html`
  — losing either is exactly how this regression happened the first time.

## 12. One merged PDF instead of a ZIP

The client asked for a single deliverable: the Summary first, then the test
reports in chronological order. The export no longer builds a ZIP of separate
files; `buildExportPdf()` renders each planned document, loads it with
pdf-lib, and copies its pages into one output document.

Two decisions worth knowing about:

- **Pages are copied, never re-laid-out.** `copyPages` carries each source
  page's own content stream, resources and size across unchanged, so every
  layout this document spent so long getting right survives the merge intact.
  The output mixes page sizes freely — the Summary is landscape A4 and the
  reports are portrait — which is legal and what readers expect here.
- **Ordering is fixed at parse time, not at click time.** Each report plan
  carries the `samplingDate` its mapped model held, so `exportOrder()` sorts
  the plan list the click handler captured rather than re-reading module
  state that a reset could have changed mid-build.

`exportOrder()` sorts by document kind first (`DOCUMENT_KIND_ORDER`, which
lists the two withheld kinds too so restoring them needs no change), then by
sampling date. `samplingOrder()` accepts the workbook's day-first
`dd/mm/yyyy` and ISO `yyyy-mm-dd`, and returns `Infinity` for anything else
so an undated report sorts last rather than being guessed at. Two undated
documents compare equal rather than being subtracted — `Infinity - Infinity`
is `NaN`, which sorts unpredictably. Because `Array.prototype.sort` is
stable, reports sharing a sampling date (the usual case: one vessel sampled
across a day) keep the workbook's own order, which is the order the Summary
table lists them in.

A document that fails to render is still skipped rather than failing the
whole export, and the feedback line names it.

`src/zip-writer.js` and its tests were removed with this change: the merged
PDF was its only caller. It is recoverable from git history if a ZIP is ever
wanted again.

### The public link is one document too

A package link used to render a list of "View document" buttons, one per
share. It now merges the same way the export does and shows the result in the
ordinary report panel — one preview, one download. `src/pdf-merge.js` is a
classic script precisely so both callers share it: `workspace.js` is a classic
script and `view-report.js` is an ES module, and neither can import the
other's format.

The viewer orders the merge from the published payload rather than from the
bundle's own list order, so a link's pages come out in the same order the
downloaded export would produce. `shareSortKey()` reads each share's
`documentData`: `renderer: "summary"` (or the legacy `documentSlug` of
`"Summary"`) puts it first, and a report contributes
`report.cover.samplingDate`. `samplingOrder()` is the workspace's own rule,
duplicated deliberately — `view-report.js` cannot import from a classic
script, and moving it into `pdf-merge.js` would mix an ordering policy into a
byte-level utility. The two are kept in step by tests on both sides.

Rebuilding is split so both callers can reuse it: `rebuildDocument()` returns
bytes or `null`, `resolveDocumentUrl()` wraps that into a blob URL for a
single share, and `sharedDocumentBytes()` fetches the static asset when there
is nothing to rebuild — so an older asset-backed share still contributes its
pages to a package instead of dropping out of it. Only when *every* document
fails does the viewer show a status message.

One consequence: `resolveDocumentUrl()` now returns a promise for every
rebuilt document, where the generic worksheet path used to return a string
synchronously. Both call sites already wrapped it in `Promise.resolve`, so
this was invisible at runtime, but tests calling it directly must await it.

### Testing a merge

Asserting a merge needs the output to say which document produced each page.
`workspace.test.js` gives each stubbed renderer a unique page *width* —
widths survive `copyPages` exactly — and reads them back off the downloaded
blob. Two things this forced:

- Renderer stubs must return **real** PDFs. The old stubs returned the four
  bytes `%PDF`, which the ZIP happily stored and pdf-lib rightly refuses.
- A test that releases a deferred `fetch` must first wait for that fetch to
  have been called. `buildExportPdf` awaits `PDFDocument.create()` before it
  reaches the first document, so the old release-immediately timing raced.
