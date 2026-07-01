# DocuAlign System Design & Architecture Specification

## 1. Executive Summary & Purpose

**DocuAlign** is an enterprise laboratory reporting web application built to modernize and structure the current manual workflow of converting spreadsheet test data into standardized, audit-ready PDF engineering reports.

### The Problem
Laboratory test reports for geotechnical and reclamation sand testing are currently maintained in Microsoft Excel workbooks. Operators manually copy or position test results from Excel into desktop PDF editing software (such as Adobe Acrobat). This manual workflow introduces severe operational risks:
1. **Layout Fragility:** Font rendering, scaling, and table alignment shift between different desktop computers, operating systems, and PDF editor versions.
2. **Data Isolation:** Data locked inside desktop Excel workbooks and flat PDFs cannot be searched, filtered, audited, or tracked over time across an enterprise.
3. **Reproduction Overhead:** Regenerating or correcting a historical report requires repeating the error-prone manual positioning process from scratch.

### The DocuAlign Solution
DocuAlign establishes a clean decoupling between **Source Data** (Excel workbook), **Structured Persistence** (Firebase Cloud Firestore), and **Presentation Output** (Standardized PDF Export):
1. **Ingestion (ETL):** Operators drag and drop laboratory workbooks into the secure web interface. Processing occurs entirely locally on the client device during initial extraction.
2. **Structured Review:** Values are mapped into logical report keys based on visible domain labels rather than unreliable AcroForm field identifiers.
3. **Persistent Records:** Verified report data is saved directly into cloud storage (`docuAlignReports`), enabling full historical dashboard tracking and date filtering.
4. **Consistent Output:** Final PDF documents are exported from controlled templates that guarantee bit-for-bit visual layout consistency regardless of the operating environment.

---

## 2. High-Level System Architecture

DocuAlign is built using a hybrid **Multi-Page Application (MPA)** and **Modular Frontend** architecture powered by **Vite**, **React**, **Vanilla ES Modules**, and **Firebase SDK v12**.

```mermaid
graph TD
    subgraph Client [Browser Environment]
        IndexPage["index.html (ETL / New Report UI)"]
        DashboardPage["dashboard.html (Saved Reports UI)"]
        AppShell["src/App.jsx (React Workspace Shell)"]
        Styles["src/styles.css (Design System)"]
        
        subgraph Logic Modules
            AuthGate["src/auth-gate.js (Session & Gatekeeper)"]
            SaveReport["src/save-report.js (Cloud Persistence Wiring)"]
            DashboardLogic["src/dashboard.js (Grid & Date Filtering)"]
            ReportsLib["src/lib/reports.js (Firestore CRUD & Filters)"]
            FirebaseLib["src/lib/firebase.js (Core SDK Initialization)"]
        end
    end

    subgraph StaticAssets [Dual Asset Directory Contract]
        RootSample["/SampleDocuments/SampleOutput.pdf (file:// fallback)"]
        PublicSample["/public/SampleDocuments/SampleOutput.pdf (HTTP bundle)"]
    end

    subgraph FirebaseCloud [Firebase Cloud Ecosystem crewhub-43647]
        FirebaseAuth["Firebase Authentication (Google OAuth 2.0)"]
        FirestoreDB["Cloud Firestore Database"]
        
        subgraph SharedRules [Shared Security Boundary]
            WorkGridNS["/users, /teams, /bookings (WorkGrid namespace)"]
            CubeSyncNS["/appConfig/access (Shared Staff Allowlist)"]
            DocuAlignNS["/docuAlignReports/{document=**} (DocuAlign namespace)"]
        end
    end

    IndexPage --> AuthGate
    IndexPage --> SaveReport
    DashboardPage --> AuthGate
    DashboardPage --> DashboardLogic
    SaveReport --> ReportsLib
    DashboardLogic --> ReportsLib
    ReportsLib --> FirebaseLib
    AuthGate --> FirebaseLib

    IndexPage --> RootSample
    IndexPage --> PublicSample

    FirebaseLib --> FirebaseAuth
    FirebaseLib --> FirestoreDB
    AuthGate -. Probe Read .-> DocuAlignNS
```

### Module Responsibilities
* **`index.html`**: Primary landing page providing local drag-and-drop workbook ingestion, visual progression through the three-stage ETL pipeline (`Extract`, `Transform`, `Validate`), PDF download triggers, and cloud saving.
* **`dashboard.html`**: Cloud dashboard enabling authenticated staff to browse historical reports, view metadata (source filename, creator, timestamp), and filter records dynamically by date range.
* **`src/auth-gate.js`**: Enforces strict enterprise access control. Restricts UI access until a verified Google session passes an active Firestore probe against `docuAlignReports/access-probe`.
* **`src/lib/reports.js`**: Pure domain library providing server-timestamped document creation (`saveReport`), descending ordered retrieval (`fetchReports`), and client-side date range filtering (`filterReportsByDate`).
* **`src/lib/firebase.js`**: Singleton initialization of Firebase App, Firestore, Auth, and Storage with HMR/test environment protection (`getApps().length`).

---

## 3. UML Behavioral & Workflow Diagrams

### 3.1 ETL & UI State Machine Diagram
The frontend progresses through well-defined operational states to ensure users verify workbook data before cloud persistence.

```mermaid
stateDiagram-v2
    [*] --> Unauthenticated: Open Application
    Unauthenticated --> AccessProbing: Sign in with Google
    AccessProbing --> Unauthenticated: Access Denied (Not CubeSync Staff)
    AccessProbing --> WaitingForWorkbook: Access Approved

    state WaitingForWorkbook {
        [*] --> DropzoneIdle
        DropzoneIdle --> DropzoneDragging: Drag File Over
        DropzoneDragging --> DropzoneIdle: Drag Leave
        DropzoneDragging --> FileSelected: Drop .xlsx/.xls
        DropzoneIdle --> FileSelected: Browse & Select File
    }

    WaitingForWorkbook --> ETLProcessing: File Selected
    
    state ETLProcessing {
        [*] --> Extracting: Stage 1 (Read Workbook)
        Extracting --> Transforming: Stage 2 (Map Logical Keys)
        Transforming --> Validating: Stage 3 (Check Schema)
        Validating --> ReviewReady: Pipeline Complete
    }

    ETLProcessing --> ReviewReady
    ReviewReady --> ExportingPDF: Click "Export final PDF"
    ExportingPDF --> CloudSaveAvailable: Download Triggered
    CloudSaveAvailable --> SavingToCloud: Click "Save data to cloud"
    SavingToCloud --> Complete: Report Saved to Firestore
    Complete --> WaitingForWorkbook: Remove / Replace File
```

### 3.2 End-to-End Sequence Diagram
Illustrates the chronological interaction between the user, browser modules, local static assets, and cloud backend during report creation.

```mermaid
sequenceDiagram
    autonumber
    actor User as Operator
    participant UI as index.html / UI Shell
    participant Auth as src/auth-gate.js
    participant Firebase as Firebase Auth / Firestore
    participant ETL as ETL Pipeline (Client JS)
    participant Asset as SampleDocuments PDF Asset
    participant Store as src/lib/reports.js

    User->>UI: Open application URL
    UI->>Auth: Check existing session
    Auth->>Firebase: onAuthStateChanged()
    alt User not signed in
        Auth->>UI: Display Auth Gate Screen
        User->>Auth: Click "Continue with Google"
        Auth->>Firebase: signInWithPopup(GoogleAuthProvider)
        Firebase-->>Auth: Return verified user credentials
    end
    
    Auth->>Firebase: getDoc(docuAlignReports/access-probe)
    Note over Firebase: Firestore Security Rules verify<br/>isCubeSyncStaff() via appConfig/access
    alt Probe rejected (Permission Denied)
        Firebase-->>Auth: 403 Permission Denied
        Auth->>Firebase: signOut()
        Auth->>UI: Show access denied error
    else Probe approved
        Firebase-->>Auth: Probe doc / Success
        Auth->>UI: Reveal protected workspace shell
    end

    User->>UI: Drop Excel workbook (.xlsx)
    UI->>ETL: selectFile(workbook)
    ETL->>UI: Update visual state (Extracting -> Transforming -> Validating)
    Note over ETL: Processing stays 100% local inside browser memory
    ETL-->>UI: Enable "Export final PDF" button

    User->>UI: Click "Export final PDF"
    UI->>Asset: Request ./SampleDocuments/SampleOutput.pdf
    Asset-->>UI: Stream full 5-page PDF binary
    UI-->>User: Download report PDF
    UI->>UI: Enable "Save data to cloud" button

    User->>UI: Click "Save data to cloud"
    UI->>Store: saveReport(db, { reportName, sourceFileName, status, createdBy })
    Store->>Firebase: addDoc(collection('docuAlignReports'), payload)
    Firebase-->>Store: Document Reference ID
    Store-->>UI: Return success
    UI-->>User: Display persistent feedback confirmation
```

---

## 4. Entity-Relationship (E/R) Data Model

DocuAlign shares a Firestore database instance with `WorkGrid` and `CubeSync`. To prevent data corruption and ensure clean namespace isolation, all DocuAlign records live under `docuAlignReports/{document=**}`.

### 4.1 Global Shared Firestore Ecosystem E/R Diagram

```mermaid
erDiagram
    APP_CONFIG_ACCESS {
        list masterEmails "Verified bootstrap master emails"
        list allowedEmails "Approved staff email list"
        string updatedAt "Last update timestamp"
    }

    USERS {
        string uid PK "Firebase Auth UID"
        string name "User display name"
        string email "Verified email address"
        string role "worker | engineer | admin"
        string status "active | inactive"
    }

    DOCUALIGN_REPORTS {
        string id PK "Auto-generated document ID"
        string reportName "Slugified report title"
        string sourceFileName "Original uploaded Excel filename"
        string status "draft | complete"
        string createdBy "Email of creator"
        timestamp createdAt "Server timestamp"
        string client_name "Mapped logical key: Client Name"
        string job_ref "Mapped logical key: Job Reference"
        string vessel_name "Mapped logical key: Vessel Name"
    }

    PARTICLE_SIZE_ROWS {
        string id PK "Row sub-document ID"
        string report_id FK "Parent report reference"
        number sieve_size_mm "Sieve mesh aperture size"
        number cumulative_percent_passing "Passing percentage"
        number lower_limit "JTC standard lower limit"
        number upper_limit "JTC standard upper limit"
        number sort_order "Display sequence index"
    }

    DIRECT_SHEAR_ROWS {
        string id PK "Row sub-document ID"
        string report_id FK "Parent report reference"
        number normal_stress_kpa "Normal stress applied"
        number max_shear_stress_kpa "Maximum measured shear stress"
        number horizontal_displacement_mm "Horizontal displacement at failure"
        number sort_order "Display sequence index"
    }

    METALLIC_ANALYSIS_ROWS {
        string id PK "Row sub-document ID"
        string report_id FK "Parent report reference"
        string element_name "Chemical element (Arsenic, Lead, Zinc, etc.)"
        number result_ppm "Measured concentration in PPM"
        number upper_limit_concentration_ppm "Maximum allowable concentration"
        number sort_order "Display sequence index"
    }

    REPORT_PHOTOS {
        string id PK "Photo sub-document ID"
        string report_id FK "Parent report reference"
        string photo_url "Firebase Storage download URL"
        string caption "Appendix visual caption"
        number sort_order "Display sequence index"
    }

    APP_CONFIG_ACCESS ||--o{ USERS : authorizes
    APP_CONFIG_ACCESS ||--o{ DOCUALIGN_REPORTS : "gates access via isCubeSyncStaff()"
    DOCUALIGN_REPORTS ||--o{ PARTICLE_SIZE_ROWS : contains
    DOCUALIGN_REPORTS ||--o{ DIRECT_SHEAR_ROWS : contains
    DOCUALIGN_REPORTS ||--o{ METALLIC_ANALYSIS_ROWS : contains
    DOCUALIGN_REPORTS ||--o{ REPORT_PHOTOS : includes
```

### 4.2 Logical Field Key Mapping Strategy
Because uploaded Excel-generated PDFs lack AcroForm field dictionaries, DocuAlign maps source Excel cells directly to semantic domain keys defined in `rak_pdf_excel_field_mapping.json`:

| Semantic Section | Logical Key | Excel Source Example | Description |
| :--- | :--- | :--- | :--- |
| **Cover Page** | `client_name` | `'CV1 (2)'!K5` | Client corporate identity |
| **Cover Page** | `project_code_title` | `'CV1 (2)'!K12` | Project specification title |
| **Cover Page** | `job_ref` | `'CV1 (2)'!K15` | Unique laboratory tracking reference |
| **Test Metadata** | `sampling_date` | `'CV1 (2)'!K18` | Field sampling date |
| **Grading Table** | `particle_size_distribution` | Repeatable Subcollection | Sieve test row collection |
| **Shear Test** | `direct_shear` | Repeatable Subcollection | Shear stress evaluation points |
| **Signatures** | `authorised_by_name` | `'CV1 (2)'!Footer` | Certifying laboratory officer |

---

## 5. Security & Access Control Architecture

Security rules are enforced on the server via `firestore.rules`. Client-side UI checks (`auth-gate.js`) provide immediate UX gating, but cloud data is guarded exclusively by Firebase Security Rules.

### 5.1 Shared Rules Contract
The database instance hosts WorkGrid, CubeSync, and DocuAlign. Security rules must strictly preserve existing rules blocks while defining isolated access for DocuAlign:

```text
service cloud.firestore {
  match /databases/{database}/documents {
    // Shared allowlist check used by both CubeSync and DocuAlign
    function isCubeSyncStaff() {
      return isVerifiedEmail() &&
        (isHardcodedStaff() ||
          (hasAccessConfig() &&
            ('allowedEmails' in accessConfig() &&
              request.auth.token.email.lower() in accessConfig().allowedEmails)));
    }

    // DocuAlign Dedicated Namespace Block
    match /docuAlignReports/{document=**} {
      allow read, write: if isCubeSyncStaff();
    }
  }
}
```

### 5.2 Access Probing Mechanism
When a user authenticates via Google OAuth, `src/auth-gate.js` performs a probe read against `docuAlignReports/access-probe`:
1. If the user's email is present in `appConfig/access.allowedEmails` or hardcoded masters, Firestore allows the read. The application shell opens.
2. If the read fails with `permission-denied`, the user is immediately logged out and shown an access rejection notice.

---

## 6. Asset Contract & Deployment Topology

To ensure seamless execution across both local filesystem development (`file://`) and production HTTP deployments (Vite build output), DocuAlign enforces a **Dual Asset Directory Contract**:

```text
DocuAlign/
├── SampleDocuments/
│   ├── SampleOutput.pdf               <-- Serves direct index.html file:// opening
│   ├── SampleOutput-cover.pdf
│   └── SampleInput.xlsx
├── public/
│   └── SampleDocuments/
│       ├── SampleOutput.pdf           <-- Copied by Vite into dist/ for HTTP servers
│       └── SampleOutput-cover.pdf
```

Vitest automated verification (`src/pdf-export.test.js`) verifies that both PDF assets exist, share the exact same SHA-256 cryptographic hash, and contain the full five pages (`%PDF-` signature check).
