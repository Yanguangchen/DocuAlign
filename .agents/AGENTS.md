# DocuAlign Agent Rules & Developer Guidelines

This document specifies the critical behavioral, architectural, and quality rules for all AI agents, automated assistants, and human engineers contributing to the **DocuAlign** repository.

---

## 1. Shared Database & Firestore Security Rules Constraint

> [!CAUTION]
> **CRITICAL SHARED DATABASE WARNING:**
> DocuAlign shares a single production Firebase project (`crewhub-43647`) and Cloud Firestore database instance with other ecosystem applications (`WorkGrid` and `CubeSync`). All applications share the exact same `firestore.rules` file.

When modifying or auditing `firestore.rules`:
1. **NEVER** edit, delete, or reorder existing security rule blocks for `WorkGrid` (`/users`, `/teams`, `/bookings`, `/collisions`) or `CubeSync`.
2. **ALWAYS** keep DocuAlign rules scoped strictly within the dedicated `match /docuAlignReports/{document=**}` block.
3. Access to DocuAlign must use the shared `isCubeSyncStaff()` helper or `isDocuAlignStaff()` alias to ensure access matches verified CubeSync staff members.
4. Always run Firestore emulator unit tests (`npm run test:rules`) when making security rule changes if an emulator environment is available.

---

## 2. Dual Asset Directory Contract (PDF Export)

DocuAlign supports two execution environments:
1. Direct filesystem execution (`file://` opening of `index.html`).
2. Bundled HTTP/HTTPS execution (via `npm run dev` or Vite production build output in `dist/`).

To support both environments without 404 file errors:
* The static cover reference PDF **must exist identically** at both paths:
  - `SampleDocuments/SampleOutput-cover.pdf`
  - `public/SampleDocuments/SampleOutput-cover.pdf`
* Never remove either copy. `src/pdf-export.test.js` enforces that both files exist and share the exact same SHA-256 hash. If you update the sample PDF, you **must update both locations**.

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

3. **Logical Field Keys vs PDF AcroForms:**
   * Uploaded Excel-generated PDFs do not contain AcroForm dictionaries.
   * Always map report fields using semantic logical keys (`client_name`, `job_ref`, `particle_size_distribution`, etc.) as documented in `rak_pdf_excel_field_mapping.json` and `design.md`.

---

## 4. Code Quality & Testing Expectations

When modifying any codebase file:
1. **Run Linting:** Always verify zero lint warnings by running `npm run lint`.
2. **Run Tests:** Ensure all unit tests pass with `npm test`.
3. **Documentation Integrity:** Preserve all existing comments and docstrings. Add clear, professional file-level headers and JSDoc comments to newly added or modified modules.
4. **No Console Spam:** Avoid leaving stray `console.log` debugging statements. Keep error logging structured (`console.error('[DocuAlign] ...', error)`).
