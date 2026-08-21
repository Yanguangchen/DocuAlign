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

> [!NOTE]
> That gap is now closed — see §13. Pictures are uploaded to Cloud Storage at
> save time and the payload carries their download URLs, so a share rebuilds
> with the workbook's own artwork while `documentData` stays around 7 KB.
> `withoutPictureBytes` still strips the bytes; it just adds a `url` alongside
> the metadata it already kept.

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
package over `MAX_BUNDLE_REPORTS` (250) surfaces that reason rather than
inviting a retry that cannot succeed.

Two consequences to keep in mind: a recipient now sees every document in a
report rather than only what was ticked, and re-enabling the DS1/SB1 and
standalone-worksheet exports takes a workbook from 7 documents back to 20+.

The 25-document ceiling that warning anticipated was reached first from the
other direction: at ~7 documents per report it stopped staff at four reports
per package. The cap existed to keep an unrolled per-member rules validator
inside Firestore's expression budget, so §17 replaces that validator with a
constant-cost one and raises the cap to 250. The dashboard's selection count
now says when a selection is over the cap, and the group button explains the
refusal instead of offering a retry.

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

## 12. One download, documents kept separate

The client wants one action, not one file. The export delivers a ZIP holding
each document as its own PDF — the archive is only a wrapper so there is a
single download. A public package link goes further and keeps the files
genuinely separate: one button saves every document individually, with no
container at all. A merged single-PDF version of this was built and then
reverted (`Merge every exported document into one PDF`, `Serve a public
package link as one merged PDF`).

`src/pdf-merge.js` survives that revert, but only for **printing** — see
"Print all" below. Nothing it produces is ever delivered as a file.

### Ordering

The ordering the merge introduced was kept, because it is worth having either
way: `exportOrder()` sorts by document kind first (`DOCUMENT_KIND_ORDER`,
which lists the two withheld kinds too so restoring them needs no change),
then by sampling date. Each report plan carries the `samplingDate` its mapped
model held, so the order is fixed when the workbook is parsed rather than
re-derived from module state mid-build.

`samplingOrder()` accepts the workbook's day-first `dd/mm/yyyy` and ISO
`yyyy-mm-dd`, and returns `Infinity` for anything else so an undated document
sorts last rather than being guessed at. Two undated documents compare equal
rather than being subtracted — `Infinity - Infinity` is `NaN`, which sorts
unpredictably. Because `Array.prototype.sort` is stable, reports sharing a
sampling date (the usual case: one vessel sampled across a day) keep the
workbook's own order, which is the order the Summary table lists them in.

A document that fails to render is skipped rather than failing the whole
export, and the feedback line names it.

### The public link

A package link lists every document as its own card, in that same order, and
adds one **Download all N documents** button above the list.

`downloadEveryDocument()` rebuilds each share and saves it as its own file —
nothing is bundled, not even into an archive. The saved names are numbered
(`01-Summary.pdf`, `02-Test-Report-X-1.pdf`) so the files sort in package
order, and sanitised because they come from staff-entered report titles. A
document that cannot be rebuilt is skipped and named in the button's status
line; only when every document fails does the button report that nothing could
be prepared.

Browsers throttle a burst of programmatic downloads and prompt before allowing
several, so the downloads are spaced by `DOWNLOAD_INTERVAL_MS` (350ms) and the
success line tells the recipient to allow multiple downloads if asked. That
prompt is the accepted cost of keeping the files separate; wrapping them in a
ZIP would avoid it, and was tried and rejected.

### Print all — the one place a merge is right

Beside it sits **Print all N documents**, and this one *does* merge. That is
not a contradiction: a print job is one document by definition, so printing
six reports separately would mean six print dialogs. `buildPrintJob()` rebuilds
every share and merges them through `src/pdf-merge.js`; `printDocument()` puts
the result in a hidden iframe and calls `contentWindow.print()`.

The distinction to hold on to is **delivered vs printed**. Nothing merged is
ever saved: no `<a download>` is handed the merged bytes, and
`pdf-export.test.js` asserts that the download path never reaches `mergePdfs`.
The merged document exists only long enough to reach the printer.

Three details that matter:

- The iframe **stays in the document while the dialog is open** — removing it
  cancels the job in some browsers — and is cleared with its object URL on the
  same `REVOKE_DELAY_MS` grace period a download gets.
- `contentWindow` can be null (a blocked frame) or lack `print` (a browser
  rendering PDFs without an embedded viewer). Both are checked; when printing
  is unavailable nothing throws, and the per-document links remain.
- The merge preserves each page's own size, so the landscape Summary and the
  portrait reports each print at their intended orientation.

Rebuilding is split so both paths reuse it: `rebuildDocument()` returns bytes
or `null`, `resolveDocumentUrl()` wraps that into a blob URL for one card, and
`sharedDocumentBytes()` fetches the static asset when there is nothing to
rebuild — so an older asset-backed share still contributes its own file to the
download (or the print job) instead of dropping out of it.

One consequence of that split: `resolveDocumentUrl()` now returns a promise
for every rebuilt document, where the generic worksheet path used to return a
string synchronously. Both call sites already wrapped it in `Promise.resolve`,
so this is invisible at runtime, but tests calling it directly must await it.

### Testing separate documents

Every delivered file is a real PDF, so a test tells them apart by giving each
stubbed renderer a unique page **width** and reading the widths back. In the
export they come off the unpacked archive entries; on the share page they come
off the blobs `URL.createObjectURL` was handed, paired with each anchor's
`download` name. Four things this forced:

- Renderer stubs must return **real** PDFs. Older stubs returned the four
  bytes `%PDF`, which a ZIP happily stores but pdf-lib rightly refuses.
- A test that waits for the export to finish should wait on the archive being
  packed (`docuAlignZip.createArchive`), not on the `fetch` that starts it —
  the rendering in between is several microtasks long. The zip writer's API is
  frozen, so wrap it rather than spying on it in place.
- The share page's listing creates one blob per card before any download
  starts, so a test must take the *trailing* blobs — one per anchor click — as
  the saved files.
- Printing is asserted by finding the `iframe.print-frame`, defining a
  `contentWindow` on it, and dispatching `load`; the merged bytes are read off
  the last blob `createObjectURL` was handed.

## 13. Shared reports showed the wrong photographs

Reported as "the package link doesn't display the correct report — the
extracted photos, vessel name and details are incorrect". Two independent
defects were behind it, and the second one (§14) is what made the *details*
look wrong. This section covers the photographs.

### Diagnosis

The question worth settling first was whether the shared photographs were
*static* or merely *mismatched*, because those have different fixes. Measured
by rastering page 5 and diffing the two appendix photo boxes —
`(105.84, 172.08, 368.49, 260.79)` and `(105.84, 475.68, …)`:

| Comparison | Pixels different |
| --- | --- |
| Downloaded export vs reference sample | 344,728 |
| Downloaded export vs another report's export | 342,022 |
| **Shared copy vs reference sample** | **0** |

So downloads were genuinely per-report, and every *share* was serving the
bundled sample's artwork — 100% static. That is the §3a gap reaching a user,
not a new regression.

### Fix

`src/lib/report-photos.js` uploads each picture to
`docuAlignReportPhotos/{reportId}/{assetKey}` at save time and returns a map of
asset key to download URL. `withoutPictureBytes` writes that URL into the
published payload beside the metadata it already kept, and
`src/view-report.js`'s `withRestoredPictures` fetches the bytes back before
handing the model to `createRakReportPdf`.

Verified end to end: a round-tripped share now differs from the local export by
**0 px** across both photo boxes, and `documentData` stays at ~7,327
characters — nowhere near the 100,000 bound.

### Why no public read rule

`getDownloadURL()` mints a URL carrying its own unguessable access token, and
**that token grants the read** — the request never consults the Storage rules.
This is the same capability-URL model the share tokens already use, so
`storage.rules` restricts reads to verified staff and the bucket is never
publicly listable or browsable. Do **not** "fix" a working share by relaxing
that to `allow read: if true`; it would not change share behaviour at all, and
would expose every other app's objects to enumeration.

### Failure is silent, by design

`uploadReportPhotos` catches **per asset**, so one rejected picture leaves that
one image out of the map and the share falls back to the reference artwork for
it — the save still succeeds. This is deliberate (a bad photo must not lose a
report) but it means a misconfigured bucket looks exactly like the original
bug. When photographs are wrong or missing on a share, check the browser
console for `PhotoUploadFailure` before touching the renderer; the log carries
the asset key and the underlying error.

### Operating notes

- **The bucket folder does not exist until the first successful upload.**
  Firebase Storage lists prefixes that have objects under them, not
  directories, so `docuAlignReportPhotos/` is absent from the console until one
  report saves. An empty file list is not evidence that the code is broken.
- **Reports saved before this shipped have no uploaded pictures** and must be
  re-saved to pick them up. Uploading happens at save time only; there is no
  backfill.
- The write rule requires `contentType.matches('image/.*')`. That is safe
  because `pictureMediaType` in `src/xlsx-reader.js` only ever yields
  `image/png` or `image/jpeg` and discards any other media type before it
  reaches the upload — the `application/octet-stream` fallback in
  `uploadReportPhotos` is unreachable for real workbook pictures. Widening the
  reader's accepted types without widening the rule would start silent upload
  failures.
- The app writes to `crewhub-43647.firebasestorage.app`, from `storageBucket`
  in `src/lib/firebase.js`. If uploads fail everywhere at once, confirm that
  value still matches the bucket shown in the console.

## 14. Reports sharing a job reference overwrote each other

The other half of the "wrong report" complaint, and the reason vessel names and
details looked wrong rather than merely stale.

`saveReportDocuments(db, reportId, documents)` wrote each document to
`.../documents/{entry.slug}`, and the slug came from `reportIdentifier()` —
`slugify(job_ref)`. Two reports sharing a job reference therefore resolved to
the **same document path**, and the later save silently overwrote the earlier
one. Proved directly: saving three reports left one document in Firestore, so
every card served whichever report was written last.

`claimSlug()` now claims each slug against a per-save `Set`, appending the
report's own suffix on collision (`x-2026-522`, `x-2026-522-2`, …). The fix was
written test-first; the failing test asserted three distinct stored paths.

Worth knowing when reading old data: **reports saved before this fix lost the
overwritten documents**, and no repair is possible from Firestore alone. They
have to be re-saved from the workbook.

## 15. Photographs anchored off the sample's exact cell

A later test still produced wrong photographs on *one* report while the others
were right — which rules out both §13 and §14, since a Storage or slug problem
takes every report with it.

### The export path is not the problem

Re-audited first, because it is cheap and it removes half the search space.
Rendering all six groups of `SampleInput.xlsx` through the real pipeline and
checking the generated PDFs for each group's own picture bytes:

```
group 0: photo0(e08f62aa41):PRESENT  photo1(80eb8f0d0c):PRESENT  | foreign: none
… all six identical
```

Every report embeds its own two photographs and no other group's. The reader
extracts distinct pictures per group. So a wrong photograph on a *downloaded*
export cannot be cross-contamination between reports — the only remaining way
to get one is for extraction to find nothing and the reference artwork to
survive.

### Root cause

`appendixPhotos` selected `image.row >= 147 && image.column === 5` — the sample
workbook's exact anchor. Column had **zero** tolerance. A photograph dragged
into place one column off yields an empty list, and because
`rak-report-pdf.js` skips the whiteout for a picture with no bytes (§3, the
signature-erasure guard), the reference page keeps its own photographs.

That combination is the nastiest failure mode in this pipeline: no error, no
missing image, a complete-looking report carrying **another sample's
evidence**. It is also per-report, since anchors drift one worksheet at a time
— exactly the reported symptom.

### Fix

The strict anchor is tried first and a wider window (`row >= 140`,
`column >= 1`) is used **only when it finds nothing**. This cannot change any
workbook the strict rule already matches — verified by re-running the six-group
audit unchanged. The window's bounds are chosen against the sample's own
furniture: below row 140 clears the signature band (rows 129–131), and right of
column 0 clears the letterhead marks at rows 0, 40, 87 and 137.

### Diagnostic

`reportPictureExtraction` in `src/workspace.js` now warns
`Some reports carry no appendix photographs` with the offending group numbers
(`category: "MissingReportPictures"`). The whole point is that this failure is
invisible in the output, so the console has to say it. If a report still shows
wrong photographs and **no** such warning appears, extraction succeeded and the
problem is downstream — Storage upload or fetch, per §13.

## 16. No absolute coordinate survives a second workbook

The widened window in §15 was still positional, and a real client report
proved that insufficient. A report for vessel `ZHOU SHUN 9` (`X-2024-002-1`)
rendered its cover correctly — client, job reference, vessel, PSD table all
from the uploaded workbook — and then showed appendix photographs of a sample
bag labelled `Vessel: JIAHE 99 / CH: 3-A`. That is group 2 of
`SampleInput.xlsx`, which is exactly what `SampleOutput.pdf` carries. The
report had fallen through to the reference artwork again.

### Why widening could never have been enough

The sample's appendix sits at rows 147 and 169 **because of where that
workbook's rows happen to end**. A client report with fewer result rows puts
its appendix somewhere else entirely. No constant works, and the ±few-row
tolerance §15 added only bought margin for a workbook that was already nearly
identical.

Worse, the same fragility ran through signature detection
(`row >= 129 && row <= 131`), and the two interact. Shifting the sample's
anchors down 40 rows in a test made a *photograph* land inside the signature
band, so it was claimed as the prepared signature and then excluded from the
appendix. One positional rule silently corrupted the other. This was caught by
the shift test below, before shipping — not in production.

### The structural rule

Two facts hold across layouts, and neither is a coordinate:

1. **The letterhead is the only picture a report sheet repeats** — once per
   printed page. Everything repeated is furniture.
2. **The report's own pictures run in document order**: the sign-off block,
   then the appendix.

So `reportPictures` drops every repeated image, sorts what is left by row, and
takes the bottom two as the photographs and the two above them as the
signatures (left-hand column is prepared, right-hand authorised). Repetition is
detected by **`bytes` identity**, not by hashing: `readSheetImages` inflates
each media part once through `mediaCache` and hands every anchor the same
array, so one letterhead is one object no matter how many times it is anchored.

The sample's exact anchor is still tried first, so a workbook laid out like the
sample cannot change behaviour at all.

### Verification

- **No regression.** All six groups of `SampleInput.xlsx` still embed their own
  two photographs, byte-for-byte, with no foreign photographs — identical to
  the §13 audit.
- **The fallback recovers real pictures.** Re-mapping the sample workbook with
  every anchor shifted (`-40 rows/-3 cols`, `+25 rows/+2 cols`,
  `-60 rows/0 cols`) so the positional anchor cannot match: all six groups
  recover both photographs **and** both signatures, matching the unshifted
  result exactly. This is the test that failed on the first attempt and drove
  the redesign.

### Confirmed against the uploaded workbook

The customer opened the source workbook and photographed the `TR1 (4)` sheet.
It settles the diagnosis: the appendix photographs are present and correct in
the workbook (a bag labelled `Vessel: ZHOU SHUN 9 / Voy: ZS9-17N / CH: 4-A`),
anchored at approximately rows 147 and 170 — **but around column 2–3, not
column 5**. The rows matched the sample; one column of drift was the entire
cause of a report shipping another vessel's evidence.

Note that the widened window from §15 (`column >= 1`) would have matched this
particular sheet. The report was tested roughly four minutes after that fix
merged, so it most likely ran against the previous production build. That
changes nothing about the conclusion: a window is still a coordinate, and the
next workbook moves again.

### The remaining assumption

Furniture below the appendix is excluded only if it repeats. A one-off footer
image anchored beneath the photographs on a sheet that has no other copy of it
would be taken for a photograph. Nothing in the sample workbook does this, and
a letterhead by nature repeats, but it is the assumption to check first if this
recurs.

### The guard against recurrence

`src/report-mapping.test.js` → `"recovers the real workbook's own pictures at
any anchor"` re-maps the real workbook three times with every anchor shifted so
the positional fast path cannot match, and asserts each group recovers its own
photographs and signatures by bytes. Verified to fail against the old
behaviour.

The rule this defect produced, and what to check before touching picture
handling again, is written up separately in
**[workbook-picture-identification.md](./workbook-picture-identification.md)**.

## 17. Four reports was the whole package

### Symptom

Selecting more than four reports on the dashboard and pressing **Create package
link** produced *"Could not create the group link. Try again."* Retrying never
worked. Fewer reports published fine.

### Root cause

Two separate things, one behind the other.

`MAX_BUNDLE_REPORTS` was 25 and `publishBundle` throws above it. A card-level
tick expands to every document the report stored, and a saved report is
currently about seven documents, so the fifth report crossed the cap. The
number staff were choosing (reports) and the number the cap counted
(documents) were never the same number, and only the second one was enforced.

The cap itself was not a product decision. `isValidDocuAlignBundleTokens` in
`firestore.rules` validated the list by unrolling one indexed check per allowed
member, so its expression cost grew with the cap — and Firestore allows 1,000
expressions per evaluation (see
[firestore-rules-expression-limit.md](./firestore-rules-expression-limit.md)).
25 was what that shape could afford.

### Fix

The validator now checks the whole list as one joined string, at a cost that
does not change with the list's length:

```
value.join(',').size() == value.size() * 33 - 1 &&
value.join(',').matches('^[A-Za-z0-9]{32}(,[A-Za-z0-9]{32})*$')
```

Both lines are load-bearing. The regex forces the joined string into groups of
exactly 32 alphanumerics separated by commas; the length check pins the number
of those groups to the list size, so a member holding `<token>,<token>` cannot
satisfy the pattern by itself and pass as two. A non-string member makes
`join()` error, which denies the write. The token pattern is unchanged and the
access contract — public `get`, denied `list`, staff-only `create`/`delete`,
immutable — is untouched.

With cost flat, the cap becomes a product number. Emulator probing found no
rules ceiling worth calling one: 10,000 members validate as fast as 250, in the
same ~130ms. What bounds a package now sits downstream of the write --
publishing fires one Firestore write per document, and the viewer then reads one
document per member, rebuilds every PDF in the browser, and holds them all in
memory to build the ZIP. `MAX_BUNDLE_REPORTS` is 250, roughly 35 saved reports;
raising it further is a question about the customer's browser, not Firestore.

Two UI changes finish it. The selection count in the bundle bar now says when a
selection is over the cap and disables the button, because a card shows how
many documents it adds but never the running total. And `handleBundleClick`
surfaces a `TypeError` message the way the single-report share button already
did, so a refusal that retrying cannot fix stops inviting a retry.

### Verification performed

`src/firestore.rules.test.js` publishes a full 250-member bundle against the
emulator and asserts denial at 251, at zero members, for a malformed member,
for a non-string member, and for the comma-carrying member the length check
exists to stop. `src/dashboard.test.js` ticks seven-document reports and
expects the button armed at 28 documents, blocked with the cap named at 252,
and re-armed at 245.

### What to check before touching this again

The cap lives in two places — `MAX_BUNDLE_REPORTS` in `src/lib/share.js` and
the literal in `isValidDocuAlignBundleTokens`. They must match; the client
check is the one that produces a readable message, the rules check is the one
that is actually enforced. Raising it further is safe as far as the rules go --
they were measured flat to 10,000 members -- but the viewer fetches one document
per member and builds every PDF in the browser, so the next ceiling is the
customer's page, not Firestore.
