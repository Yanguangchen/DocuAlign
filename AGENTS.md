# DocuAlign Agent Rules & Developer Guidelines

This document specifies the critical behavioral, architectural, and quality rules for all AI agents, automated assistants, and human engineers contributing to the **DocuAlign** repository.

---

## 1. Shared Database & Firestore Security Rules Constraint

> [!CAUTION]
> **CRITICAL SHARED DATABASE WARNING:**
> DocuAlign shares a single production Firebase project (`crewhub-43647`) and Cloud Firestore database instance with other ecosystem applications (`WorkGrid` and `CubeSync`). All applications share the exact same `firestore.rules` file.

When modifying or auditing `firestore.rules`:
1. **NEVER** edit, delete, or reorder existing security rule blocks for `WorkGrid` (`/users`, `/teams`, `/bookings`, `/collisions`) or `CubeSync`.
2. **ALWAYS** keep DocuAlign rules scoped strictly within the dedicated DocuAlign section: the `match /docuAlignReports/{document=**}`, `match /docuAlignPublicShares/{shareToken}`, and `match /docuAlignPublicBundles/{bundleToken}` blocks.
3. Access to DocuAlign must use the shared `isCubeSyncStaff()` helper or `isDocuAlignStaff()` alias to ensure access matches verified CubeSync staff members. The exceptions are `docuAlignPublicShares` and `docuAlignPublicBundles`, whose capability-URL contract is deliberate: public `get`, denied `list`, staff-only `create`/`delete`, denied `update`, 32-character alphanumeric document IDs, and strict payload allowlists (`isValidDocuAlignPublicShare`, `isValidDocuAlignPublicBundle`). Never widen this contract — in particular never allow `list`, never add staff emails or other PII to the payload allowlists, and never weaken the token ID pattern. Bundles must keep storing share TOKENS only (1..25): embedding report snapshots was measured to exceed Firestore's 1000-expressions-per-evaluation rules limit.
4. Always run Firestore emulator unit tests (`npm run test:rules`) when making security rule changes if an emulator environment is available.
5. **Firestore rules have a hard 1,000-expression-per-request evaluation cap.** Exceeding it produces the exact same `Missing or insufficient permissions` error as a real authorization failure, so it is easy to misdiagnose as a bug in access logic instead of a rules-cost problem. Before adding or changing any validator that loops over a list (per-row, per-entry, per-field), or any helper that calls `request.resource.data.diff(resource.data)`, read **[documentation/firestore-rules-expression-limit.md](./documentation/firestore-rules-expression-limit.md)** and test the change against the emulator with a realistic maximum-size payload, not just a minimal one.

---

## 1a. Shared Cloud Storage Bucket Constraint

> [!CAUTION]
> The same sharing applies to **Cloud Storage**. `crewhub-43647.firebasestorage.app` holds WorkGrid's and CubeSync's objects (`fleet_claims/`, `job-completion-signatures/`) alongside DocuAlign's.

1. `storage.rules` in this repository carries the **DocuAlign block only**. It is deliberately **not** referenced from `firebase.json`, so a routine `firebase deploy` cannot overwrite another app's rules. Do not wire it in.
2. Deploy it by pasting the `match /docuAlignReportPhotos/{reportId}/{picture}` block into the existing rules in the Firebase console, leaving every other match intact. Never paste the file wholesale.
3. Everything this app writes stays under the `docuAlignReportPhotos/` prefix (`REPORT_PHOTO_PREFIX` in `src/lib/report-photos.js`). Never write outside it.
4. **Reads stay closed.** Public shares do not read through these rules — `getDownloadURL()` mints a URL carrying its own unguessable access token, and that token grants the read. Never relax this to `allow read: if true`; it would not change share behaviour and would expose the other apps' objects to enumeration.
4a. **`isDocuAlignStaff()` in `storage.rules` must mirror `isCubeSyncAllowedEmail()` in `firestore.rules`.** Anyone who can save a report must be able to upload its pictures. Do NOT gate DocuAlign paths on WorkGrid's `isActiveUser()`: six DocuAlign staff — including the lab engineer who signs the reports — are on the CubeSync allowlist but absent from `isHardcodedMaster` and have no `users/{uid}` profile. A mismatch never raises an error; the save succeeds, the uploads are refused, and the shared report silently shows the reference sample's photographs. When either allowlist changes, update both.
5. Uploads fail **silently per asset** by design, so a rules misconfiguration presents as "the share shows the wrong photographs" rather than as an error. Check the browser console for `PhotoUploadFailure` before suspecting the renderer. See [documentation/report-export-static-asset-fix.md](./documentation/report-export-static-asset-fix.md) §13.

---

## 2. Dual Asset Directory Contract (PDF Export)

DocuAlign supports two execution environments:
1. Direct filesystem execution (`file://` opening of `index.html`).
2. Bundled HTTP/HTTPS execution (via `npm run dev` or Vite production build output in `dist/`).

To support both environments without 404 file errors:
* The static full report reference PDF (`SampleOutput.pdf`) and cover reference (`SampleOutput-cover.pdf`) **must exist identically** at both paths:
  - `SampleDocuments/SampleOutput.pdf`
  - `public/SampleDocuments/SampleOutput.pdf`
* Never remove either copy. `src/pdf-export.test.js` enforces that both files exist and share the exact same SHA-256 hash. If you update the sample PDF, you **must update both locations**.

---

## 2a. Workbook Pictures Are Identified By Structure, Never By Coordinates

> [!CAUTION]
> A report whose pictures are not extracted does **not** render blank. `rak-report-pdf.js` skips the whiteout when a picture has no bytes, so the copied reference page keeps `SampleOutput.pdf`'s own photographs. A failed extraction therefore ships **another vessel's sample photographs inside a signed lab report**, with no error, no missing image, and every other field correct.

This defect shipped three times, each fix a wider version of the same mistake. The rules:

1. **Never make an absolute row or column the primary selector** for a report's pictures. The sample workbook's anchors (photographs at rows 147/169 column 5, signatures at rows 129–131) are wherever *that* workbook's rows happened to end. A real client workbook drifts, and one column of drift was enough to cause the production case.
2. Pictures are identified structurally by `reportPictures` in `src/report-mapping.js`: drop every image repeated on the sheet (the letterhead is anchored once per printed page), sort the rest by row, take the bottom two as appendix photographs and the two above as signatures. Repetition is detected by `bytes` object identity — the reader inflates each media part once and shares the array.
3. A hard-coded anchor may exist **only** as a fast path with the structural rule behind it.
4. **Never change one picture predicate in isolation.** Signatures and photographs are selected from the same list; a shifted photograph once landed in the signature band, was claimed as a signature, and was dropped from the appendix.
5. **Never treat an empty extraction as a benign no-op.** Emit the `MissingReportPictures` warning (`reportPictureExtraction` in `src/workspace.js`) so the console reports what the page cannot.
6. Run the guard: `src/report-mapping.test.js` → `"recovers the real workbook's own pictures at any anchor"` re-maps the real workbook with every anchor shifted. Passing on `SampleInput.xlsx` alone proves nothing — that is exactly how this recurred.

Full reasoning, the production evidence, and the pre-change checklist: **[documentation/workbook-picture-identification.md](./documentation/workbook-picture-identification.md)**.

---

## 3. Architecture & Frontend Standards

1. **Technology Stack:**
   * Core structure: Vanilla HTML5 (`index.html`, `dashboard.html`), Vanilla CSS (`src/styles.css`), Vanilla ES Modules (`src/*.js`), and React (`src/App.jsx`).
   * Build Tool: Vite 6.x.
   * Testing Framework: Vitest + Testing Library + Happy DOM.
   * Linting: ESLint 9 (Flat config).

2. **Styling & Aesthetics:**
   * Use custom CSS tokens defined in `src/styles.css`.
   * Maintain rich, premium aesthetics (glassmorphism cards, micro-animations, clear step indicators, accessible color contrast).
   * **Do NOT introduce Tailwind CSS** or third-party UI component libraries unless explicitly instructed by the user.

3. **REQUIREMENT — One `CV1` + `TR1` Sheet Group = One Test Report:**

   > [!IMPORTANT]
   > **A workbook holds MANY test reports, never one.** A single uploaded workbook must produce **N separate PDFs**, where N is derived from that file. Collapsing a workbook into one combined PDF is a defect.

   > [!CAUTION]
   > **NEVER ALTER THE TEST REPORT FORMAT.** The `CV1` + `TR1` test report document is the client's established deliverable and its layout is FIXED. Its five pages are **copied** from `SampleDocuments/SampleOutput.pdf` (`REPORT_ASSET_PATH` in `src/workspace.js`, `TEMPLATE_PATH` in `src/rak-report-pdf.js`) and only the uploaded workbook's own values are overlaid at coordinates measured from that reference — **never** re-rendered, re-laid-out, restyled, or regenerated from worksheet data, and never passed through the generic table renderer. Do not "improve" or reformat it. This applies no matter what other export work is being done: changes to the summary, datasheets, or any other document must leave the test report layout untouched. `src/pdf-export.test.js` and `src/workspace.test.js` both lock this in.

   > [!IMPORTANT]
   > **The exported report must carry the uploaded workbook's data.** Serving the reference PDF unchanged is a defect, not the contract: every group's own client, job ref, cargo hold, and results must appear in its own PDF. `src/report-mapping.js` maps each worksheet group to the semantic report model and `src/rak-report-pdf.js` overlays it onto the copied reference pages; both are classic scripts loaded by `index.html` (and `rak-report-pdf.js` by `view.html`) and listed in `classicScripts` in `vite.config.js`. If a workbook cannot be mapped, the export falls back to serving the reference asset so nothing fails outright — that fallback is a safety net, never the normal path.

   * **Every worksheet group is its own document.** The export emits, as separate PDFs: one per test report (`CV1` + `TR1` together), one per `DS1` datasheet, one per `SB1` datasheet, and one for each standalone worksheet (`Summary`, `coral + org`, …). `SampleInput.xlsx` therefore plans **20** documents: 6 reports + 6 DS1 + 6 SB1 + Summary + coral + org.

   > [!NOTE]
   > **TEMPORARY EXPORT RESTRICTION (currently in force).** Only the `CV1` + `TR1` test reports and the `Summary` document are exported today — `SampleInput.xlsx` therefore downloads and saves **7** documents, not 20. The `DS1`/`SB1` datasheets and the remaining standalone worksheets (`coral + org`, …) are still planned, rendered, and serialised by the existing code; they are only withheld by `TEMPORARILY_DISABLED_DOCUMENT_KINDS` in `src/workspace.js`. Do **not** delete the planning or rendering code behind them. Emptying that list (or calling `setDisabledDocumentKinds([])`) restores the full 20-document export.
   * **Only the supporting worksheets go through the generic writer.** `src/pdf-writer.js` renders the `coral + org`, `DS1`, and `SB1` documents from parsed sheet data; the summary has its own fixed-format renderer (`src/summary-pdf.js`) and the test report its own overlay renderer — both are excluded from the generic path by design, see the caution above.
   * **Excel serials and number formats must be converted.** Cell display values are resolved through `xl/styles.xml`: date-formatted cells render `DD/MM/YYYY` (a raw `46120` in output is a bug), and fixed-decimal formats keep the precision Excel shows — a `0.0` cell caching `34.9041486172` must read `34.9`, because the PDF renderers draw these strings verbatim. Rounding is half away from zero, like Excel's, so `20.15` in a `0.0` cell reads `20.2` and not `toFixed`'s `20.1`. Percent, scientific, and fraction formats are deliberately left alone. Cells with no such format are normalised to 12 significant digits so `63.099999999999994` reads as `63.1`.

   * **The defining unit is a `CV1` + `TR1` pair.** `CV1` is the report's cover sheet and `TR1` its test results; the `DS1` (sieve datasheet) and `SB1` (direct shear datasheet) sheets are supporting data for the same report. Groups are distinguished by Excel's duplicate-sheet suffix: `CV1`/`TR1`, `CV1 (2)`/`TR1 (2)`, `CV1 (3)`/`TR1 (3)`, and so on.
   * **N is always read from the uploaded file. Never hardcode it.** Three `CV1`/`TR1` pairs means three reports; six pairs means six. `SampleDocuments/SampleInput.xlsx` contains **six** groups (26 worksheets, `CV1` through `CV1 (6)`), carrying job refs `X-2026-522-1` through `X-2026-522-6` — verify against the sheet list before assuming a different count.
   * Each report is identified by its **own** job ref, read per group (`CV1!K28`), so exported file names stay distinct. Do not identify a report using another group's sheets.
   * Excel's duplicate naming leaves inconsistent whitespace (`DS1  (2)` has two spaces), so sheet prefixes must be compared with whitespace collapsed.
   * **The export button delivers one ZIP, never one merged PDF.** Every planned document is rendered to its own PDF and packed into `<workbook>.zip` (`buildExportArchive`/`docuAlignZip.createArchive` in `src/workspace.js`) — the archive is only a wrapper so there is a single download and a single browser prompt. Documents inside the ZIP are ordered Summary first, then test reports by sampling date (`exportOrder`/`DOCUMENT_KIND_ORDER`/`samplingOrder`). **Never merge the export's documents into one PDF** — that was built and deliberately reverted; see `documentation/report-export-static-asset-fix.md` §12.
   * Parsing (`src/xlsx-reader.js`) and PDF generation (`src/pdf-writer.js`) are both **classic scripts** (like `src/early-observability.js`): they must never use `import`/`export`, must stay listed in `classicScripts` in `vite.config.js`, and must be loaded by `<script vite-ignore>` tags *before* `src/workspace.js`, so the workspace keeps working over `file://`. Both are dependency-free by design — the repo ships no xlsx or PDF library, and none should be added without cause.

4. **Packages (Grouped Share Links):**
   * A **package** is one `docuAlignPublicBundles` capability token exposing multiple documents. Any document can be packaged — test reports, `DS1`/`SB1` datasheets, the summary, and `coral + org` — and documents are selected individually on the dashboard, so one package can mix documents from different reports.
   * Each packaged document is published as its **own** share token so it stays individually revocable. Bundles store TOKENS only (1..`MAX_BUNDLE_REPORTS` = 25); never embed report snapshots (see §1.3 — measured to exceed the 1000-expression rules limit).
   * A generated document publishes its worksheet grid as a **single JSON string** (`documentData`, ≤ 100,000 chars) and the public viewer rebuilds the PDF with `src/pdf-writer.js`. Keep it one bounded string: validating it costs the rules exactly one expression no matter how many rows the sheet holds. Never expand it into per-row or per-field rule validation.
   * The test report publishes its **mapped model** the same way (`{renderer: "report", report: {…}}`, ~7 KB per report against the 100,000-char bound) and `view.html` rebuilds it by overlaying that model onto the reference pages, so a shared report shows the uploaded workbook's data rather than the sample. Only a report that could not be mapped falls back to `pdfUrl` with `documentData: null`.
   * Exported documents persist to a `documents` subcollection under each saved report. Firestore cannot store nested arrays, so grids are held as JSON strings, not `rows: [[...]]`.
   * `view.html`'s package panel lists every document as its own card, in `exportOrder`'s Summary-first / sampling-date order, plus two buttons: **Download all N documents** (`downloadEveryDocument` in `src/view-report.js`) saves each document as its own file — no ZIP, no merge — and **Print all N documents** (`buildPrintJob`) merges every document through `src/pdf-merge.js` and hands the result to a hidden iframe's `print()`.

   > [!CAUTION]
   > **The print-all merge must never become a download.** `src/pdf-merge.js` exists for the print path only — `mergePdfs` output must never be handed to an `<a download>` or saved anywhere. `src/pdf-export.test.js` locks in that the download code path never calls `mergePdfs`. If a future change needs a downloadable multi-document PDF, that is a deliberate product decision requiring explicit user sign-off, not a refactor — a merged single-PDF export was built and reverted once already (`documentation/report-export-static-asset-fix.md` §12).

5. **Logical Field Keys vs PDF AcroForms:**
   * Uploaded Excel-generated PDFs do not contain AcroForm dictionaries.
   * Always map report fields using semantic logical keys (`client_name`, `job_ref`, `particle_size_distribution`, etc.) as documented in `rak_pdf_excel_field_mapping.json` and `design.md`.

---

## 4. Code Quality & Testing Expectations

When modifying any codebase file:
1. **Run Linting:** Always verify zero lint warnings by running `npm run lint`.
2. **Run Tests:** Ensure all unit tests pass with `npm test`.
3. **Test-Driven Development & Coverage Baseline:** Develop features test-first (write the failing spec, then the implementation). The audited coverage baseline for `src/**` is 100% statements / branches / functions / lines (`npm run coverage`); do not regress it.
4. **Documentation Integrity:** Preserve all existing comments and docstrings. Add clear, professional file-level headers and JSDoc comments to newly added or modified modules.
5. **No Console Spam:** Avoid leaving stray `console.log` debugging statements and never call `console.*` directly from feature code. Log through the central structured logger (`src/lib/logger.js`): `logInfo`/`logWarn`/`logError(message, error, context)` with `feature`/`function`/`operation`/`category` context fields, and wrap async Firestore/network operations in `trackOperation` so latency and outcome are recorded. Page entry modules must call `initObservability()` (`src/lib/observability.js`) to capture uncaught errors and unhandled rejections.
