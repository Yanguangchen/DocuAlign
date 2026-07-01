/**
 * @file App.jsx
 * @description React-based workspace component for interactive Excel workbook ingestion.
 * Implements local drag-and-drop file selection, validation against `.xlsx`/`.xls` formats,
 * and user action controls for file replacement and cloud save wiring.
 */
import { useRef, useState } from "react";

const EXCEL_EXTENSIONS = [".xlsx", ".xls"];

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isExcelFile(file) {
  const name = file.name.toLowerCase();
  return EXCEL_EXTENSIONS.some((extension) => name.endsWith(extension));
}

function CloudIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7.5 18.5h10a4 4 0 0 0 .7-7.94A6.5 6.5 0 0 0 5.72 9.4 4.6 4.6 0 0 0 7.5 18.5Z" />
      <path d="m9.2 12.7 2.8-2.8 2.8 2.8M12 10v6" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6.5 2.75h7l4 4v14.5h-11z" />
      <path d="M13.5 2.75v4h4M9 11h6M9 14h6M9 17h4" />
    </svg>
  );
}

function App() {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [message, setMessage] = useState("");

  function selectFile(nextFile) {
    if (!nextFile) return;

    if (!isExcelFile(nextFile)) {
      setFile(null);
      setMessage("Choose an Excel workbook in .xlsx or .xls format.");
      console.warn("[DocuAlign] File validation failure", {
        feature: "WorkspaceIngestion",
        function: "selectFile",
        operation: "validateExtension",
        rule: "EXCEL_EXTENSIONS",
        actualExtension: nextFile.name?.slice(nextFile.name.lastIndexOf(".")) || "unknown",
      });
      return;
    }

    setFile(nextFile);
    setMessage("");
  }

  function handleDrop(event) {
    event.preventDefault();
    setIsDragging(false);
    selectFile(event.dataTransfer.files[0]);
  }

  function removeFile() {
    setFile(null);
    setMessage("");
    inputRef.current.value = "";
  }

  function handleCloudSave() {
    setMessage("Cloud saving will be connected in the next step.");
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="DocuAlign home">
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span>DocuAlign</span>
        </a>
      </header>

      <main>
        <section className="workspace" aria-label="Excel report import">
          <div className="step-label">
            <span>01</span>
            <div>
              <strong>Import source file</strong>
              <p>Your workbook stays on this device for now.</p>
            </div>
          </div>

          <div
            className={`dropzone ${isDragging ? "is-dragging" : ""} ${file ? "has-file" : ""}`}
            onDragEnter={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) {
                setIsDragging(false);
              }
            }}
            onDrop={handleDrop}
          >
            <input
              ref={inputRef}
              id="excel-file"
              type="file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              onChange={(event) => selectFile(event.target.files[0])}
            />

            {file ? (
              <div className="selected-file">
                <span className="file-icon"><FileIcon /></span>
                <div className="file-details">
                  <strong>{file.name}</strong>
                  <span>{formatFileSize(file.size)} / Ready to import</span>
                </div>
                <div className="file-actions">
                  <button className="text-button" type="button" onClick={() => inputRef.current?.click()}>
                    Replace
                  </button>
                  <button className="text-button danger" type="button" onClick={removeFile}>
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <label htmlFor="excel-file" className="dropzone-prompt">
                <span className="upload-symbol" aria-hidden="true"><CloudIcon /></span>
                <strong>{isDragging ? "Release to add workbook" : "Drop your Excel workbook here"}</strong>
                <span>or <u>browse from your computer</u></span>
                <small>.XLSX or .XLS</small>
              </label>
            )}
          </div>

          <div className="action-row">
            <p className={message ? "feedback is-visible" : "feedback"} aria-live="polite">
              {message || "No data leaves your device until you choose to save it."}
            </p>
            <button className="primary-button" type="button" disabled={!file} onClick={handleCloudSave}>
              <CloudIcon />
              Save data to cloud
            </button>
          </div>
        </section>

        <aside className="next-step" aria-label="Next step preview">
          <span>02</span>
          <div>
            <strong>Review extracted data</strong>
            <p>Confirm report details, test results, and attachments.</p>
          </div>
          <span className="coming-soon">Next</span>
        </aside>
      </main>

      <footer>
        <span>RAK report workspace</span>
        <span>Excel in / Structured data / PDF out</span>
      </footer>
    </div>
  );
}

export default App;
