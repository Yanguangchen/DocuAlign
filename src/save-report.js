/**
 * @file save-report.js
 * @description Cloud persistence controller for the primary ETL workspace (`index.html`).
 * Connects the "Save data to cloud" action to Firestore, creating structured report
 * records (`docuAlignReports`) linked to the authenticated user's session.
 */
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "./lib/firebase.js";
import { saveReport, saveReportDocuments } from "./lib/reports.js";
import { buildBundleUrl, buildPublicUrl, publishBundle, publishReport } from "./lib/share.js";
import { openShareModal } from "./lib/share-ui.js";
import { logWarn, trackOperation } from "./lib/logger.js";
import { initObservability } from "./lib/observability.js";

initObservability();

const cloudSave = document.querySelector("#cloud-save");
const fileName = document.querySelector("#file-name");
const feedback = document.querySelector("#feedback");

/** Where the share modal's "View on dashboard" action sends staff. */
const DASHBOARD_PATH = "./dashboard.html";

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

/**
 * Publish the just-saved report as a public link, so the share modal can offer
 * WhatsApp and email straight away rather than sending staff to the dashboard
 * to press "Create public link" as a second errand.
 *
 * Publishing is best-effort: the report is already safely in the cloud, so a
 * failure here degrades to "saved, share it from the dashboard" instead of
 * looking like the save itself failed.
 * @param {Object} report - The saved report, carrying its Firestore id.
 * @param {Array<Object>} documents - Its exported documents, possibly empty.
 * @returns {Promise<string|null>} The public URL, or null if publishing failed.
 */
export async function publishSavedReport(report, documents) {
  try {
    // A report with documents publishes as a package so the recipient gets
    // every PDF; one saved before per-document storage has only itself.
    if (documents.length > 0) {
      const token = await trackOperation(
        "Publish report package link",
        {
          feature: "PublicShare",
          function: "publishSavedReport",
          operation: "firestore.setDoc",
          collection: "docuAlignPublicBundles",
          safeIdentifier: report.reportName,
        },
        () => publishBundle(
          db,
          documents.map((document) => ({ report, document })),
          { name: report.reportName },
        ),
      );
      return buildBundleUrl(token);
    }

    const token = await trackOperation(
      "Publish public share link",
      {
        feature: "PublicShare",
        function: "publishSavedReport",
        operation: "firestore.setDoc",
        collection: "docuAlignPublicShares",
        safeIdentifier: report.reportName,
      },
      () => publishReport(db, report),
    );
    return buildPublicUrl(token);
  } catch (error) {
    logWarn("Could not publish the saved report's share link", {
      feature: "PublicShare",
      function: "publishSavedReport",
      operation: "firestore.setDoc",
      category: "SharePublishFailure",
      errorMessage: String(error),
    });
    return null;
  }
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
    const reference = await trackOperation(
      "Save report to cloud",
      {
        feature: "CloudPersistence",
        function: "cloudSave.onClick",
        operation: "firestore.addDoc",
        collection: "docuAlignReports",
        safeIdentifier: reportNameFromSource(source),
      },
      () =>
        saveReport(db, {
          reportName: reportNameFromSource(source),
          sourceFileName: source,
          status: "complete",
          createdBy: currentUser.email ?? null,
        }),
    );

    // Persist every exported document so each can be shared individually and
    // grouped into packages from the dashboard.
    const documents = globalThis.docuAlignWorkspace?.getExportDocuments() ?? [];
    if (documents.length > 0) {
      await trackOperation(
        "Save report documents",
        {
          feature: "CloudPersistence",
          function: "cloudSave.onClick",
          operation: "firestore.setDoc",
          collection: "docuAlignReports/documents",
          safeIdentifier: reportNameFromSource(source),
        },
        () => saveReportDocuments(db, reference.id, documents),
      );
    }

    const savedReport = {
      id: reference.id,
      reportName: reportNameFromSource(source),
      sourceFileName: source,
      status: "complete",
    };
    const shareUrl = await publishSavedReport(savedReport, documents);

    setFeedback(
      documents.length > 0
        ? `Report saved with ${documents.length} documents. View it anytime on the dashboard.`
        : "Report saved. View it anytime on the dashboard.",
    );

    // The payoff of the whole drop-to-share workflow: the link is live and
    // one tap from WhatsApp, email, or the dashboard.
    if (shareUrl) {
      openShareModal(shareUrl, savedReport.reportName, { dashboardUrl: DASHBOARD_PATH });
    }
  } catch {
    // Failure already logged by trackOperation; recover the UI.
    cloudSave.disabled = false;
    setFeedback("Could not save the report. Check your connection and try again.");
  }
});
