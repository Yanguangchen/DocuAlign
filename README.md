# RAK Report Parser and PDF Generator

## Overview

This app converts the client current Excel based reporting workflow into a structured web app workflow.

### Support diagnostics

Every page captures structured lifecycle, network, authentication, and global
error events without including capability-token query strings. In the browser
console, `docuAlignDiagnostics.getSnapshot()` returns a serializable support
snapshot containing the session ID, page uptime, connectivity, recent event
counts, the latest 50 events, and any tracked operations that are still active.
Operations taking at least three seconds also emit a `SlowOperation` warning.

The client currently maintains test report data inside an Excel file. That Excel data is then manually copied or positioned into a PDF editor such as Adobe Acrobat. This causes alignment issues because the final PDF layout may shift depending on the computer, PDF editor settings, fonts, scaling, printer settings, or the time the file is opened and edited.

The goal of this app is to make the Excel file the import source, store the report data in the web app, and allow users to export or print a clean PDF report anytime.

## Problem

The current workflow is fragile.

1. The Excel file contains the actual report data.
2. The PDF report is manually prepared from the Excel data.
3. Users need to use Acrobat or another PDF editor to fill or position the information.
4. Text and table alignment can shift across computers.
5. Reprinting or regenerating the same report is difficult because the final PDF depends on manual editing.
6. The data is not easily searchable, editable, reusable, or auditable inside a web system.

## Proposed Solution

The app will replace manual PDF editing with a structured report generation workflow.

1. User uploads an Excel report file.
2. The app parses the Excel file.
3. The parsed data is mapped into report fields inside the web app.
4. The user can review and edit the imported data through CRUD screens.
5. The report data is saved into the database.
6. The user can select any saved report.
7. The user can export the report as PDF or print it anytime.

## Core Concept

The Excel file is treated as the source data.

The PDF is treated as the output format.

The app should not depend on Acrobat form field keys because the existing PDF may not contain reliable or correctly named fields. Instead, the app should use logical field keys that correlate with the visible report labels.

For example, even if the PDF field key is wrong or missing, the app should still understand that:

Client Name maps to the client name shown on the cover page.

Job Ref maps to the job reference shown on every report page.

Vessel Name maps to the vessel name shown on the cover page and appendix label.

Particle Size Distribution maps to the grading table and grading chart.

Moisture Content maps to the moisture content test result section.

## Workflow

### Current Workflow

1. Client prepares Excel report.
2. User opens PDF editor.
3. User manually fills or positions values into the PDF.
4. Alignment may shift.
5. Final PDF is saved manually.
6. Any correction requires manual editing again.

### New Workflow

1. User uploads Excel report into the web app.
2. App extracts report data.
3. App stores data in structured fields.
4. User reviews and edits the report in the web app.
5. App generates the PDF using a controlled template.
6. User can export or print the report anytime.

## Main Features

### Excel File Parser

The parser reads the uploaded Excel file and extracts report information.

#### Requirement: one workbook contains multiple test reports

A single uploaded workbook holds **many** test reports, not one. Each test report is one `CV1` + `TR1` worksheet pair:

* `CV1` is that report's cover sheet.
* `TR1` is that report's test results.
* `DS1` and `SB1` hold the supporting sieve and direct shear datasheets for the same report.

Excel names the repeats with a duplicate suffix, so the sheets run `CV1`, `TR1`, `CV1 (2)`, `TR1 (2)`, `CV1 (3)`, `TR1 (3)`, and so on. **Three `CV1`/`TR1` pairs means three separate test reports; six pairs means six.**

The report count must always be read from the uploaded file and never hardcoded. Each report carries its own job reference (for example `X-2026-522-1`, `X-2026-522-2`, …), which distinguishes it from the others.

`SampleDocuments/SampleInput.xlsx` contains **six** report groups across 26 worksheets (`CV1` through `CV1 (6)`), with job refs `X-2026-522-1` through `X-2026-522-6`.

Expected data includes:

1. Client details
2. Project details
3. Job reference details
4. Vessel and voyage details
5. Sample details
6. Test dates
7. Test methods
8. Test standards
9. Particle size distribution results
10. Silt content
11. Coral or shell content
12. Moisture content
13. Direct shear test data
14. Organic matter content
15. Metallic analysis results
16. Remarks
17. Prepared by and authorised by details
18. Appendix photos or image references

### CRUD Report Management

Users should be able to:

1. Create report records from uploaded Excel files
2. View parsed report records
3. Edit report fields
4. Delete incorrect report records
5. Search saved reports
6. Select a saved report for export
7. Regenerate PDF reports anytime

### PDF Export

The app generates a PDF report from stored data.

#### Requirement: every worksheet group exports as its own PDF, delivered in one ZIP

Exporting a workbook produces **separate PDFs — one file per document, never a
single combined document** — packed into one `<workbook>.zip` so there is a
single download and a single browser prompt rather than a burst of them. The
archive is only a wrapper: unzip it and every document is its own byte-exact
PDF.

| Document | Count for `SampleInput.xlsx` | Named | Source |
| --- | --- | --- | --- |
| `Summary` | 1 | `<job ref> (<voyage no>_RAK SUMMARY).pdf` | Fixed-format overlay renderer (`src/summary-pdf.js`) |
| Test report (`CV1` + `TR1`) | 6 | `<job ref> (<voyage no>_RAK1)`…`_RAK6).pdf` | **Fixed format — reference pages with mapped values overlaid** |
| `DS1` sieve datasheet | 6 | `DS1 Datasheet <job ref>.pdf` | Generated |
| `SB1` direct shear datasheet | 6 | `SB1 Datasheet <job ref>.pdf` | Generated |
| `coral + org` | 1 | `coral + org.pdf` | Generated |
| **Total** | **20** | | |

The Summary and the test reports carry **the lab's own naming convention**, so
an exported package is indistinguishable from one named by hand:
`X-2026-1338 (AV-2620N_RAK SUMMARY)`, then `X-2026-1338 (AV-2620N_RAK1)`,
`…_RAK2`, and so on, numbered in the order the workbook lists its reports. The
job reference and voyage number are the package's own — read from the `Summary`
sheet (`U10` and `U12`), falling back to the reports' covers (`CV1!K28` without
its sample index, and `CV1!K30`) for a workbook with no Summary. That name is
the document's title throughout: it is the archive entry's file name, what the
dashboard and a share link display, and what a shared document downloads as
(`planExportDocuments`/`conventionalName` in `src/workspace.js`,
`packageEntryName` in `src/view-report.js`). A workbook stating neither
reference falls back to a descriptive title.

Inside the archive, documents are ordered **Summary first, then the test
reports oldest sampling date first** — the same order a package link's
"Download all" and "Print all" buttons use (see Packages, below). Reports
sharing a sampling date keep the workbook's own order.

A workbook with three `CV1`/`TR1` pairs exports proportionally fewer. The counts are always derived from the uploaded file.

> [!NOTE]
> **Temporary export restriction.** Only the `CV1` + `TR1` test reports and the `Summary` document are exported today, so `SampleInput.xlsx` currently produces **7** documents in the ZIP, not 20. The `DS1`/`SB1` datasheets and `coral + org` are still planned and rendered by the code above; they are withheld by `TEMPORARILY_DISABLED_DOCUMENT_KINDS` in `src/workspace.js` and restored by clearing that list.

> **IMPORTANT — the test report format must never be altered.**
> The `CV1` + `TR1` test report is the client's established deliverable. Its layout is fixed: the five reference pages are copied byte-for-byte and only the uploaded workbook's own values are overlaid at coordinates measured from that reference. It must never be re-rendered, restyled, or regenerated from worksheet data, regardless of what other export work is happening.

The **supporting** documents (`coral + org`, `DS1`, `SB1`) are generated in the browser from the parsed worksheet data by `src/pdf-writer.js` — no PDF library and no server involved. In those documents, Excel date serials are converted to `DD/MM/YYYY` and cached floating-point values are normalised, so they read like the source workbook rather than its raw storage. The Summary and the test report each have their own fixed-format overlay renderer instead, because both must keep an approved reference layout exactly.

The generated PDF should match the intended RAK report layout, including:

1. Cover page
2. Particle Size Distribution section
3. Grading chart
4. Silt and Coral or Shell Content section
5. Moisture Content section
6. Direct Shear section
7. Organic Matter Content section
8. Metallic Analysis section
9. Prepared By and Authorised By section
10. Appendix photo section

### Packages (grouped share links)

Any document can be shared publicly, and documents are grouped into **packages** — one capability URL that shows several documents to the recipient.

* Every document is **individually selectable** on the dashboard. Each saved report expands into its stored documents (test report, DS1, SB1, summary, coral + org), and each has its own tick-box, so a package can mix documents from different reports.
* A package holds up to **25 documents** (`MAX_BUNDLE_REPORTS`), enforced on both the client and in the Firestore rules.
* Each document in a package is published as its **own** share token, so any single document stays individually revocable by deleting its share. The package document stores only the tokens — never embedded snapshots — which keeps rules evaluation far below Firestore's 1000-expression cap.

How a recipient gets each document's bytes depends on what was published:

* The **test report** and the **Summary** each publish their own fixed-format payload (`{renderer: "report", report: {…}}` or `{renderer: "summary", cells: […]}`) and the viewer rebuilds them the same way the export does — overlaying onto the matching reference pages — so a shared copy shows the uploaded workbook's data, not the sample. Only a document that could not be mapped falls back to a static `pdfUrl`.
* Every other **generated** document (`DS1`, `SB1`, `coral + org`) publishes its worksheet grid as one JSON string (`documentData`, capped at 100,000 characters), and the viewer rebuilds the PDF locally with the same `src/pdf-writer.js` used by the export — nothing has to be hosted.

Saving a workbook persists its exported documents to a `documents` subcollection under the saved report, which is what the dashboard lists. Reports saved before this existed simply show no document list and remain shareable as a whole.

A package link's viewer page lists every document as its own card, in the export's own order (Summary first, then reports oldest sampling date first), plus two buttons above the list:

* **Download all N documents (ZIP)** rebuilds each document and packs them into **one ZIP** — each document is still its own PDF inside it, nothing is merged. The archive is only a wrapper, so the recipient gets a single download and a single browser prompt rather than a burst the browser throttles and asks to allow. It downloads as `<job ref> (<voyage no>).zip`, taking the package's own name from the documents it holds (falling back to the name the sender gave it), and entries are named into a folder of that name so it unpacks tidily.
* **Print all N documents** sends the whole package to the printer as **one job**. This is the one place documents are merged: a print job is one document by definition, so printing separately would open one dialog per report. The merged PDF is built only in memory for the print dialog and is **never saved or offered as a download**.

A document that cannot be rebuilt is skipped and named in the button's status line rather than failing the rest of the package.

### Print Support

A package link's **Print all N documents** button (above) sends every document in the package to the browser's print dialog as one merged job, so a recipient never has to open and print each document individually. It reuses the same rebuild path the download button and the individual document links use, so print output always reflects the uploaded workbook's data, and pages keep their own orientation (the landscape Summary prints landscape; the portrait reports print portrait).

### Public Share Links

Every report saved to the cloud can be published as a public, read-only share link
from the dashboard. Each card offers a **Create public link** button that:

1. Generates an unguessable 32-character capability token with `crypto.getRandomValues`.
2. Writes a sanitised, PII-free snapshot of the report (name, source file, status,
   PDF output path, publish timestamp — never the staff creator email) to the
   `docuAlignPublicShares/{token}` Firestore collection.
3. Shows the resulting URL (`view.html?share=<token>`) and copies it to the clipboard.
4. Opens a share modal showing the link with a **Copy link** button, so it can
   be picked up without selecting the text by hand. The same modal appears
   after creating a group ("package") link. The rendered link itself also keeps
   its own small copy icon afterward, for re-copying later.

Anyone holding the full URL — no Google sign-in required — can open `view.html`
to read that one report snapshot and open its PDF output. The URL is specifically
tied to the share document keyed by its token:

* Firestore rules allow public `get` on a single share document but deny `list`,
  so tokens cannot be enumerated and no other report is reachable.
* Shares are immutable snapshots; staff revoke a link by deleting its share
  document, after which the viewer shows a "no longer available" notice.
* The viewer refuses unsafe `pdfUrl` schemes (`javascript:`, `data:`, `http:`,
  protocol-relative) and falls back to the bundled report PDF.

The domain logic lives in `src/lib/share.js`; the viewer controller is
`src/view-report.js`. See `design.md` section 5.3 for the full security model.

#### Group Links (Bundles)

Several saved reports can also be grouped behind **one single public URL**.
Each dashboard card has an **Add to group link** checkbox; selecting one or
more reports reveals a group bar with a **Create group link** button that:

1. Publishes each selected report as an ordinary single share.
2. Writes a bundle document (`docuAlignPublicBundles/{token}`) that stores only
   the resulting share tokens (never embedded report data) plus an optional
   bundle name and publish timestamp.
3. Shows the group URL (`view.html?bundle=<token>`) and copies it to the
   clipboard.

A customer opening the group URL sees every grouped document on one page,
each with its own "View document" link, plus **Download all** and **Print
all** buttons above the list (see Packages, above, for what those do).
Design properties:

* A bundle may hold 1 to 25 reports (`MAX_BUNDLE_REPORTS`, mirrored in the
  Firestore rules).
* Bundles reference share tokens instead of embedding snapshots. This keeps
  every grouped report individually revocable — deleting a single share
  removes it from every group link that references it — and keeps rules
  evaluation cheap (Firestore caps each evaluation at 1000 expressions, which
  embedded per-report snapshots were measured to exceed).
* The same capability-URL contract applies: public `get`, denied `list`,
  staff-only create/delete, immutable snapshots, revocation by deletion.

#### Report Photographs (Cloud Storage)

A share's `documentData` is capped at 100,000 characters by the Firestore
rules, and a report's appendix photographs are roughly 335 KB raw (~446 KB
base64). The bytes cannot travel in the payload, so `src/lib/report-photos.js`
uploads each picture to `docuAlignReportPhotos/{reportId}/{assetKey}` in Cloud
Storage when the report is saved, and the payload carries a download URL
instead. `src/view-report.js` fetches the bytes back before rebuilding the PDF,
which keeps the payload at ~7 KB while the share shows the uploaded workbook's
own artwork.

The bucket (`crewhub-43647.firebasestorage.app`) is shared with WorkGrid and
CubeSync, so `storage.rules` holds the DocuAlign block only and is deliberately
**not** wired into `firebase.json`. Deploy it by pasting the
`docuAlignReportPhotos` match into the existing console rules, never by
replacing the file. Reads are closed to staff there on purpose: a public share
never reads through those rules, because `getDownloadURL()` mints a URL
carrying its own unguessable access token — the same capability-URL model the
share tokens use — which keeps the bucket unlistable.

Two things to know when this looks broken:

* **Uploads fail silently, per picture.** A rejected upload leaves that image
  out and the share falls back to the reference artwork for it, so a
  misconfigured bucket looks exactly like a rendering bug. Check the browser
  console for `PhotoUploadFailure` first.
* **The `docuAlignReportPhotos/` folder does not exist until the first
  successful upload**, and reports saved before this feature shipped have no
  uploaded pictures — they must be re-saved. There is no backfill.

Full record, including the pixel measurements that diagnosed it:
[documentation/report-export-static-asset-fix.md](./documentation/report-export-static-asset-fix.md)
§13.

## PDF Mapping Approach

The app should use logical field keys instead of relying on existing PDF field names.

Example logical field keys:

```text
client_name
client_address
client_tel_fax
client_email
attention_to
project_code_title
job_ref
vessel_name
voy_no
client_ref_sample_id
sampling_date
date_received
date_of_report
total_pages
remarks
````

Test result keys:

```text
particle_size_distribution
silt_content
coral_shell_content
moisture_content
direct_shear
organic_matter_content
metallic_analysis
```

Signature keys:

```text
prepared_by_name
prepared_by_title
authorised_by_name
authorised_by_title
```

Appendix keys:

```text
sample_photo_1
sample_photo_2
appendix_caption
```

## Report Sections

### Cover Page

The cover page contains the general report metadata.

Fields include:

1. Client Name
2. Address
3. Tel No and Fax No
4. Email
5. Attention To
6. Project Code or Title
7. Test Method
8. Test Standards
9. Job Ref
10. Vessel Name
11. VOY No
12. Client Ref or Sample ID
13. Sampling Date
14. Date Received
15. Date of Report
16. Total Pages
17. Remarks

### Particle Size Distribution

This section contains sieve size values, cumulative passing percentages, and JTC lower and upper limits.

The app should store the table as repeatable row data because the number of sieve rows may vary in future reports.

Suggested structure:

```text
sieve_size_mm
cumulative_percent_passing
lower_limit
upper_limit
```

The grading chart should be generated from the stored table values.

### Silt and Coral or Shell Content

This section stores:

```text
silt_content_percent
coral_shell_content_percent
total_percent
jtc_requirement
```

### Moisture Content

This section stores:

```text
moisture_content_percent
moisture_content_remarks
```

### Direct Shear

This section contains both summary values and chart data.

Summary fields include:

```text
maximum_dry_density
minimum_dry_density
percent_retained_on_2mm_sieve
shearing_rate
initial_bulk_density
initial_dry_density
angle_of_shearing_resistance
jtc_requirement
```

Table row fields include:

```text
normal_stress_kpa
max_shear_stress_kpa
horizontal_displacement_mm
```

The charts should be generated from stored direct shear data.

### Organic Matter Content

This section stores:

```text
organic_matter_content_percent
```

### Metallic Analysis

This section stores metallic element results and limits.

Suggested repeatable row structure:

```text
element_name
result_ppm
upper_limit_concentration_ppm
```

Example elements:

```text
Arsenic
Barium
Cadmium
Cobalt
Chromium
Copper
Lead
Mercury
Molybdenum
Nickel
Selenium
Zinc
```

### Appendix Photos

The appendix contains photographs of the received sample.

The app should support storing uploaded sample photos or extracted image references.

Suggested fields:

```text
appendix_title
sample_photo
sample_photo_caption
```

## Data Model

> [!IMPORTANT]
> **Shared Database & Security Rules Notice:**
> This project shares the same Firestore database instance as the other applications in the ecosystem (e.g., WorkGrid, CubeSync). Consequently, **all applications share the same `firestore.rules` file**. When adding or updating Firestore security rules for this application, ensure they are placed within dedicated blocks inside `firestore.rules` and do not alter or disrupt existing rules for other apps.

Suggested main database tables:

```text
reports
report_test_methods
report_test_standards
particle_size_rows
direct_shear_rows
metallic_analysis_rows
report_photos
```

### reports

Stores the main report details.

Example fields:

```text
id
client_name
client_address
client_tel_fax
client_email
attention_to
project_code_title
job_ref
vessel_name
voy_no
client_ref_sample_id
sampling_date
date_received
date_of_report
total_pages
remarks
prepared_by_name
prepared_by_title
authorised_by_name
authorised_by_title
created_at
updated_at
```

### particle_size_rows

Stores particle size distribution rows.

```text
id
report_id
sieve_size_mm
cumulative_percent_passing
lower_limit
upper_limit
sort_order
```

### direct_shear_rows

Stores direct shear chart and table data.

```text
id
report_id
normal_stress_kpa
max_shear_stress_kpa
horizontal_displacement_mm
sort_order
```

### metallic_analysis_rows

Stores metallic analysis data.

```text
id
report_id
element_name
result_ppm
upper_limit_concentration_ppm
sort_order
```

### report_photos

Stores appendix images.

```text
id
report_id
photo_url
caption
sort_order
```

## Key Benefit

The app removes the need to manually align text inside a PDF editor.

Instead of editing the PDF directly, users edit structured report data in the web app. The PDF is generated from a consistent template, so the layout remains stable across computers and can be regenerated anytime.

## Scope

This app should focus on:

1. Parsing Excel files
2. Mapping Excel values into report fields
3. Saving report data
4. Allowing user review and edits
5. Generating consistent PDF reports
6. Supporting browser print output

This app should not focus on:

1. Making Acrobat editing more reliable
2. Manually placing text into PDF fields
3. Depending on hidden PDF field names
4. Treating the PDF as the main source of truth

## Important Assumptions

1. The Excel report contains the source data.
2. The PDF is the final presentation format.
3. Field keys in the PDF may be incorrect or unavailable.
4. Mapping should be based on visible labels and report meaning.
5. Some report sections contain repeated table rows.
6. Some report sections require chart generation.
7. Users must be able to correct parsed data before exporting.
8. Saved reports must be reusable for future PDF export and printing.
9. This project shares the same Firestore database instance as other apps in the ecosystem, so they share the same `firestore.rules` file.

## Authentication And Access

DocuAlign uses Google sign-in through the existing Firebase project
`crewhub-43647`. Firebase Authentication accounts are project-wide, so a user
who already signs in to CubeSync uses the same Firebase account in DocuAlign.

Access is narrower than "any Google user": the account must have a verified
email present in CubeSync's `isCubeSyncAllowedEmail()` rule list. After Google
sign-in, the frontend performs a read against the protected DocuAlign namespace;
Firestore rules authorize or reject that probe before the application is shown.
The staff email list is not embedded in the public frontend bundle.

DocuAlign data must be stored under `docuAlignReports/{document=**}`. Users who
pass `isCubeSyncStaff()` receive read and write access throughout that namespace.
Existing WorkGrid and CubeSync collections keep their current independent rules.

The deliberate exceptions are `docuAlignPublicShares/{token}` and
`docuAlignPublicBundles/{token}`: share and group-link documents published by
staff are publicly readable by `get` (never `list`) so that capability URLs
work without sign-in. Only staff can create or delete them, payloads are
allowlisted to non-PII fields (bundles store only share tokens), and updates
are denied entirely.

Before deployment:

1. Enable the Google provider in Firebase Authentication for `crewhub-43647`.
2. Add the deployed DocuAlign hostname to Firebase Authentication's authorized domains.
3. Deploy the shared `firestore.rules` file without removing the existing application blocks.
4. Run the emulator-backed rules tests to verify approved and rejected access.

Authentication cannot run from `file://`. Use `npm run dev` locally or deploy
the production build over HTTP/HTTPS. The client-side gate protects navigation
and user experience; only Firebase Security Rules protect stored data from a
modified or bypassed client.

## PDF Export Asset Contract

The frontend reads every worksheet in an uploaded `.xlsx` or `.xls` file,
discovers the repeated CV/TR/DS/SB report groups, and maps each group to the
five-page RAK layout represented by `SampleOutput.pdf`. The sample workbook has
six groups, each of which becomes its own **five-page PDF** inside the
exported ZIP — never one document concatenating all six. Shared calculation
tabs remain upstream and are not dumped as raw worksheet grids.

Each test report's generated Blob copies the exact pages of `SampleOutput.pdf`,
then overlays only values, charts, signatures, and photos that differ for that
report group. The matching reference report is therefore pixel-identical to
the sample; other groups retain the same page geometry, branding, tables, and
spacing. The field-level source and transform contract is documented in
[`documentation/workbook-pdf-mapping.md`](./documentation/workbook-pdf-mapping.md).

The Summary document works the same way against its own one-page reference,
`sample_summary.pdf`. Every reference PDF must exist at both locations below:

1. `SampleDocuments/SampleOutput.pdf`, `SampleOutput-cover.pdf`, and
   `sample_summary.pdf` support direct reference access.
2. `public/SampleDocuments/` holds byte-identical copies, copied into the
   Vite production build.

The browser parser and PDF libraries follow the same direct-file/build
convention under `vendor/` and `public/vendor/`. `src/pdf-export.test.js`
enforces both the SHA-256 equality of every reference pair and the export/print
architecture itself — see that file and `documentation/report-export-static-asset-fix.md`
§12 for the currently-locked-in contract.

### Missing Export Incident

The former export button generated a valid relative URL, but the PDF only
existed under `public/` and `output/`. When `index.html` was opened directly,
the browser resolved the URL against the repository root and requested the
missing `SampleDocuments/SampleOutput.pdf` file. Chrome therefore
reported "File wasn't on site" and no download was produced.

The former UI also advanced to the cloud-save stage immediately after clicking the
link, which made the missing asset look like a successful export. The source
asset was added at the direct-file path, and `src/pdf-export.test.js` now checks
the preserved reference PDF signature, source/public equality, five-page
format, and that active exports use generated workbook Blobs.

## Testing & Coverage

The project is developed test-first (TDD) with Vitest, Testing Library, and
Happy DOM:

```bash
npm test            # full unit suite
npm run coverage    # unit suite + V8 coverage report
npm run test:rules  # Firestore security rules tests (requires the emulator)
npm run lint        # ESLint incl. eslint-plugin-security, zero warnings allowed
```

A coverage audit accompanies every feature. Current audited baseline for
`src/**` (excluding `main.jsx` and test files): **100% statements, 100%
branches, 100% functions, 100% lines**. New modules must not lower this
baseline — write the failing test first, then the implementation.

The Firestore rules suite (`src/firestore.rules.test.js`) is emulator-gated via
`RUN_FIRESTORE_RULE_TESTS=1` and covers both the staff-only report namespace
and the public share link contract (public `get`, denied `list`/enumeration,
staff-only publish, malformed-token rejection, PII allowlisting, immutability,
and revocation). Run it with:

```bash
npx firebase-tools emulators:exec --only firestore --project demo-docualign \
  "RUN_FIRESTORE_RULE_TESTS=1 FIRESTORE_EMULATOR_HOST=127.0.0.1:8087 npm run test:rules"
```

## Architecture & System Documentation

For detailed technical design specifications, UML diagrams, E/R diagrams, and developer guidelines, see:
* **[documentation/project-guide.md](./documentation/project-guide.md)** — Canonical, current-state project documentation with:
  - implemented-versus-planned capability matrix;
  - repository and module map;
  - **UML component, state-machine, and sequence diagrams**;
  - **implemented Firestore E/R diagram and schema contracts**;
  - authentication, public sharing, deployment, testing, and known limitations.
* **[documentation/workbook-pdf-mapping.md](./documentation/workbook-pdf-mapping.md)** — Page-by-page CV/TR/DS/SB cell, range, transform, chart, signature, and appendix-photo mapping.
* **[documentation/postmortem-wrong-photographs.md](./documentation/postmortem-wrong-photographs.md)** — Why a shared report showing another vessel's sample took six deployments to fix: four independent causes behind one pixel-identical symptom, the ordered decision table that separates them, and the debugging habits that turned a two-round problem into a six-round one. **Read this before investigating any wrong-photograph report.**
* **[documentation/storage-cors.md](./documentation/storage-cors.md)** — Storage rules govern the write; CORS governs whether the browser lets the viewer read the response. CORS is bucket-wide, absent by default, and cannot be set from the Firebase console — so the bucket can hold the correct photograph and still serve a report without it.
* **[documentation/workbook-picture-identification.md](./documentation/workbook-picture-identification.md)** — Why a report's photographs and signatures are identified by structure rather than by cell coordinates: the silent failure where a missed extraction ships the reference sample's photographs inside a signed report, the rule that replaced the hard-coded anchors, and the shift guard that stops it recurring. **Read before changing anything that selects pictures from a worksheet.**
* **[documentation/firestore-rules-expression-limit.md](./documentation/firestore-rules-expression-limit.md)** — Firestore's 1,000-expression-per-request rules evaluation cap: how it presents (identical error to a real permission denial), how to confirm it against the emulator, and the concrete incidents in this codebase (CubeSync batch edits, DocuAlign bundle design) that hit it.
* **[design.md](./design.md)** — Stable compatibility link to the canonical guide.
* **[AGENTS.md](./AGENTS.md)** — AI agent coding standards, shared database rules constraints, and testing protocols.
* **[rak_pdf_excel_field_mapping.json](./rak_pdf_excel_field_mapping.json)** — Detailed cell-to-logical-key mapping dictionary.

### Project Repository Structure

```text
DocuAlign/
├── SampleDocuments/                 # Static source assets for file:// execution
│   ├── SampleInput.xlsx             # Source geotechnical laboratory workbook
│   ├── SampleOutput-cover.pdf       # Verified 1-page cover PDF reference
│   ├── SampleOutput.pdf             # 5-page test report reference (CV1+TR1 layout)
│   └── sample_summary.pdf           # 1-page Summary document reference
├── public/SampleDocuments/          # Byte-identical copies for Vite HTTP deployment
├── vendor/                          # Direct-file workbook/PDF browser runtimes
├── public/vendor/                   # Vite copies of browser runtimes
├── src/
│   ├── lib/
│   │   ├── firebase.js              # Firebase SDK v12 singleton initialization
│   │   ├── reports.js               # Domain layer: Firestore CRUD & date filtering
│   │   ├── share.js                 # Domain layer: public share/bundle tokens & snapshots
│   │   ├── excel-mapping.js         # Queries the checked-in logical field dictionary
│   │   ├── logger.js                # Central structured logger (logInfo/logWarn/logError)
│   │   └── observability.js         # Uncaught error / unhandled rejection capture
│   ├── App.jsx                      # React workspace shell prototype (not mounted)
│   ├── auth-gate.js                 # Google OAuth UI gatekeeper & Firestore probe
│   ├── workspace.js                 # index.html controller: ETL pipeline, plan/order/export
│   ├── xlsx-reader.js               # Dependency-free .xlsx/.xls parser (cells, styles, media)
│   ├── report-mapping.js            # Repeated CV1/TR1/DS1/SB1 group → semantic report model
│   ├── rak-report-pdf.js            # Test report overlay renderer (copies reference pages)
│   ├── summary-pdf.js               # Summary overlay renderer (copies its own reference page)
│   ├── pdf-writer.js                # Generic renderer for DS1/SB1/coral+org worksheets
│   ├── zip-writer.js                # Dependency-free ZIP archive builder (the export button)
│   ├── pdf-merge.js                 # Page-copying PDF merger — print-all only, never delivered
│   ├── save-report.js               # Cloud persistence wiring for the ETL workspace
│   ├── dashboard.js                 # Dashboard grid, date filtering, share/package links
│   ├── view-report.js               # Public share/package viewer (unauthenticated)
│   ├── workbook-pdf.js              # Legacy xlsx-backed parser retained for test fixtures only
│   └── styles.css                   # Premium vanilla CSS tokenized design system
├── index.html                       # Primary ingestion & ETL pipeline workspace
├── dashboard.html                   # Cloud dashboard for saved reports
├── view.html                        # Public read-only share/package viewer (capability URL)
├── firestore.rules                  # Shared Firestore security rules (WorkGrid, CubeSync, DocuAlign)
├── design.md                        # Technical design specification (UML & E/R diagrams)
└── AGENTS.md                        # Developer and agent behavioral rules
```

## Future Enhancements

1. Batch import multiple Excel files
2. Duplicate job reference warning
3. Report version history
4. Approval workflow
5. Prepared by and authorised by signature upload
6. Audit log for report edits
7. PDF preview before export
8. Template version control
9. Search by client, vessel, job reference, or sample ID
