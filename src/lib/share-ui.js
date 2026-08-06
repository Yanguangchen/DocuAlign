/**
 * @file share-ui.js
 * @description The "send this link" surface shared by the ETL workspace
 * (`index.html`) and the saved-report dashboard (`dashboard.html`): clipboard
 * copying, and the modal that offers WhatsApp, email, and copy the moment a
 * capability URL exists.
 *
 * Both pages render the same `#share-modal-*` markup, so the wiring below is
 * done once here rather than duplicated per controller. Every element lookup
 * is guarded: a page (or a test) that renders no modal simply gets a no-op
 * instead of a crash in the middle of a save.
 */
import { logWarn } from "./logger.js";

const backdrop = document.querySelector("#share-modal-backdrop");
const closeButton = document.querySelector("#share-modal-close");
const linkOutput = document.querySelector("#share-modal-link");
const whatsappAction = document.querySelector("#share-modal-whatsapp");
const emailAction = document.querySelector("#share-modal-email");
const copyAction = document.querySelector("#share-modal-copy");
const dashboardAction = document.querySelector("#share-modal-dashboard");
const note = document.querySelector("#share-modal-note");

// The link the open modal points at, so its copy button can re-copy without
// threading the URL back through a DOM attribute.
let shareModalUrl = "";

/**
 * Copy a URL to the clipboard, best-effort.
 * @param {string} url - The URL to copy.
 * @param {string} caller - Logging context for a failed copy.
 * @returns {Promise<boolean>} Whether the copy succeeded, so a caller driving
 * its own UI feedback can tell success from failure.
 */
export async function copyToClipboard(url, caller) {
  if (!navigator.clipboard?.writeText) return false;

  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch (error) {
    // Copying is a convenience and must not hide the rendered capability URL,
    // but failures remain useful for diagnosing browser permission issues.
    logWarn("Clipboard copy failed", {
      feature: "PublicShare",
      function: caller,
      operation: "clipboard.writeText",
      category: "ClipboardFailure",
      errorMessage: String(error),
    });
    return false;
  }
}

/**
 * Build a WhatsApp click-to-chat URL with the share message pre-filled.
 * Opening it lands on WhatsApp Web (already signed in) or the native app,
 * with the message ready to send to whichever contact the user picks.
 * @param {string} url - The published capability URL.
 * @param {string} label - What is being shared, for the message text.
 * @returns {string} A `https://wa.me/` URL.
 */
export function buildWhatsAppShareUrl(url, label) {
  return `https://wa.me/?text=${encodeURIComponent(`${label}\n${url}`)}`;
}

/**
 * Build a `mailto:` URL that opens the visitor's default mail app with the
 * share link pre-filled in the subject and body.
 * @param {string} url - The published capability URL.
 * @param {string} label - What is being shared, for the subject/body text.
 * @returns {string} A `mailto:` URL.
 */
export function buildMailtoShareUrl(url, label) {
  const subject = encodeURIComponent(`${label} — DocuAlign report link`);
  const body = encodeURIComponent(`${label}\n\n${url}`);
  return `mailto:?subject=${subject}&body=${body}`;
}

/**
 * Open the share modal for a published link: WhatsApp and email actions ready
 * to send, plus a copy button, so staff never have to select the rendered link
 * text by hand to get it into another app.
 * @param {string} url - The published capability URL.
 * @param {string} label - Human-readable description of what is being shared.
 * @param {{dashboardUrl?: string}} [options] - `dashboardUrl` reveals a
 * "View on dashboard" action, which the workspace uses to send staff straight
 * to the documents it just saved. The dashboard itself passes none.
 * @returns {void}
 */
export function openShareModal(url, label, { dashboardUrl = "" } = {}) {
  if (!backdrop) return;

  shareModalUrl = url;
  linkOutput.textContent = url;
  whatsappAction.href = buildWhatsAppShareUrl(url, label);
  emailAction.href = buildMailtoShareUrl(url, label);
  // Only the workspace renders this action, and only it passes a URL for it.
  if (dashboardAction && dashboardUrl) {
    dashboardAction.href = dashboardUrl;
    dashboardAction.hidden = false;
  }
  note.textContent = "";
  backdrop.hidden = false;
  closeButton.focus();
}

/**
 * Close the share modal. Safe to call whether or not it is open, but only
 * reachable from a page that renders one -- the wiring below is the sole
 * caller, and it is installed only when the markup exists.
 * @returns {void}
 */
export function closeShareModal() {
  backdrop.hidden = true;
  note.textContent = "";
}

if (backdrop) {
  closeButton.addEventListener("click", closeShareModal);
  backdrop.addEventListener("click", (event) => {
    // Only the backdrop itself dismisses the modal; clicking inside the panel
    // (including its own padding) must not close it under the click.
    if (event.target === backdrop) closeShareModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !backdrop.hidden) closeShareModal();
  });
  copyAction.addEventListener("click", async () => {
    const copied = await copyToClipboard(shareModalUrl, "shareModalCopy");
    note.textContent = copied
      ? "Copied!"
      : "Could not copy — select the link above instead.";
  });
}
