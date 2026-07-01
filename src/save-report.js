/**
 * @file save-report.js
 * @description Cloud persistence controller for the primary ETL workspace (`index.html`).
 * Connects the "Save data to cloud" action to Firestore, creating structured report
 * records (`docuAlignReports`) linked to the authenticated user's session.
 */
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "./lib/firebase.js";
import { saveReport } from "./lib/reports.js";
const cloudSave = document.querySelector("#cloud-save");
const fileName = document.querySelector("#file-name");
const feedback = document.querySelector("#feedback");

let currentUser = null;

onAuthStateChanged(auth, (user) => {
  currentUser = user;
});

export function reportNameFromSource(source) {
  return (
    source
      .replace(/\.(xlsx|xls)$/i, "")
      .replace(/[^a-z0-9_-]+/gi, "-")
      .replace(/^-+|-+$/g, "") || "report"
  );
}

export function setFeedback(message) {
  if (!feedback) return;
  feedback.textContent = message;
  feedback.classList.add("is-visible");
}

cloudSave?.addEventListener("click", async () => {
  const source = fileName?.textContent?.trim();
  if (!source) {
    setFeedback("Process a workbook before saving it to the cloud.");
    return;
  }

  if (!currentUser) {
    setFeedback("Sign in again before saving to the cloud.");
    return;
  }

  cloudSave.disabled = true;
  setFeedback("Saving report to the cloud…");

  try {
    await saveReport(db, {
      reportName: reportNameFromSource(source),
      sourceFileName: source,
      status: "complete",
      createdBy: currentUser.email ?? null,
    });
    setFeedback("Report saved. View it anytime on the dashboard.");
  } catch (error) {
    cloudSave.disabled = false;
    setFeedback("Could not save the report. Check your connection and try again.");
    console.error("[DocuAlign] Failed to save report", error);
  }
});
