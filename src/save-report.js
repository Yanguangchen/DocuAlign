import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "./lib/firebase.js";
import { saveReport } from "./lib/reports.js";

// Wires the existing "Save data to cloud" button to actually persist the
// processed report into Firestore so it shows up on the dashboard. The inline
// script in index.html still owns the ETL/preview UI; this module only adds
// real persistence on top of it.
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
