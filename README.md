# RAK Report Parser and PDF Generator

## Overview

This app converts the client current Excel based reporting workflow into a structured web app workflow.

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

### Print Support

The app should allow users to print the generated report directly from the browser.

The print version should use the same layout logic as the PDF export so that print output and PDF output remain consistent.

### Public Share Links

Every report saved to the cloud can be published as a public, read-only share link
from the dashboard. Each card offers a **Create public link** button that:

1. Generates an unguessable 32-character capability token with `crypto.getRandomValues`.
2. Writes a sanitised, PII-free snapshot of the report (name, source file, status,
   PDF output path, publish timestamp — never the staff creator email) to the
   `docuAlignPublicShares/{token}` Firestore collection.
3. Shows the resulting URL (`view.html?share=<token>`) and copies it to the clipboard.

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

A customer opening the group URL sees every grouped report on one page, each
with its own "Open PDF report" button. Design properties:

* A bundle may hold 1 to 25 reports (`MAX_BUNDLE_REPORTS`, mirrored in the
  Firestore rules).
* Bundles reference share tokens instead of embedding snapshots. This keeps
  every grouped report individually revocable — deleting a single share
  removes it from every group link that references it — and keeps rules
  evaluation cheap (Firestore caps each evaluation at 1000 expressions, which
  embedded per-report snapshots were measured to exceed).
* The same capability-URL contract applies: public `get`, denied `list`,
  staff-only create/delete, immutable snapshots, revocation by deletion.

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
six groups, so its download contains six consecutive five-page reports (30
pages). Shared calculation tabs remain upstream and are not dumped as raw
worksheet grids.

The generated Blob copies the exact pages of `SampleOutput.pdf`, then overlays
only values, charts, signatures, and photos that differ for each report group.
The matching reference report is therefore pixel-identical to the sample;
other groups retain the same page geometry, branding, tables, and spacing. The
field-level source and transform contract is documented in
[`documentation/workbook-pdf-mapping.md`](./documentation/workbook-pdf-mapping.md).

The same PDF must exist at both locations below:

1. `SampleDocuments/SampleOutput.pdf` supports direct reference access.
2. `public/SampleDocuments/SampleOutput.pdf` is copied into the Vite
   production build.

The browser parser and PDF libraries follow the same direct-file/build
convention under `vendor/` and `public/vendor/`.

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
│   └── SampleOutput.pdf             # Legacy full report reference
├── public/SampleDocuments/          # Copied assets for Vite HTTP deployment
├── vendor/                          # Direct-file workbook/PDF browser runtimes
├── public/vendor/                   # Vite copies of browser runtimes
├── src/
│   ├── lib/
│   │   ├── firebase.js              # Firebase SDK v12 singleton initialization
│   │   ├── reports.js               # Domain layer: Firestore CRUD & date filtering
│   │   └── share.js                 # Domain layer: public share tokens & snapshots
│   ├── App.jsx                      # React workspace shell prototype
│   ├── auth-gate.js                 # Google OAuth UI gatekeeper & Firestore probe
│   ├── dashboard.js                 # Dashboard grid, date filtering & public share links
│   ├── save-report.js               # Cloud persistence wiring for ETL workspace
│   ├── workbook-pdf.js              # Workbook cells and embedded-media parser
│   ├── report-mapping.js            # Repeated-group semantic field mapping
│   ├── rak-report-pdf.js            # Fixed five-page RAK PDF renderer
│   ├── view-report.js               # Public share viewer controller (unauthenticated)
│   └── styles.css                   # Premium vanilla CSS tokenized design system
├── index.html                       # Primary ingestion & ETL pipeline workspace
├── dashboard.html                   # Cloud dashboard for saved reports
├── view.html                        # Public read-only share viewer (capability URL)
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
