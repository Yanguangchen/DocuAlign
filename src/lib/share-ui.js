/**
 * @file share-ui.js
 * @description The "send this link" surface shared by the ETL workspace
 * (`index.html`) and the saved-report dashboard (`dashboard.html`): clipboard
 * copying, and the modal that surfaces a capability URL the moment one exists.
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
const copyAction = document.querySelector("#share-modal-copy");
const dashboardAction = document.querySelector("#share-modal-dashboard");
const note = document.querySelector("#share-modal-note");

// The link the open modal points at, so its copy button can re-copy without
// threading the URL back through a DOM attribute.
let shareModalUrl = "";

/** Must match the exit transition on `.share-modal-backdrop` in styles.css. */
const MODAL_EXIT_MS = 220;

// Whether the modal is meant to be on screen. The `is-open` class cannot
// answer that on its own: opening defers adding it by a frame, so a dismissal
// arriving inside that frame would be undone when the frame runs.
let shareModalOpen = false;
let pendingOpenFrame = 0;

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
 * Open the share modal for a published link: the URL laid out plainly with a
 * copy button, so staff never have to select the rendered link text by hand.
 * @param {string} url - The published capability URL.
 * @param {{dashboardUrl?: string}} [options] - `dashboardUrl` reveals a
 * "View on dashboard" action, which the workspace uses to send staff straight
 * to the documents it just saved. The dashboard itself passes none.
 * @returns {void}
 */
export function openShareModal(url, { dashboardUrl = "" } = {}) {
  if (!backdrop) return;

  shareModalUrl = url;
  linkOutput.textContent = url;
  // Only the workspace renders this action, and only it passes a URL for it.
  if (dashboardAction && dashboardUrl) {
    dashboardAction.href = dashboardUrl;
    dashboardAction.hidden = false;
  }
  note.textContent = "";
  shareModalOpen = true;
  backdrop.hidden = false;
  // `hidden` is display:none, and a transition needs two rendered states to
  // move between. Painting the closed state for one frame before adding
  // `is-open` is what gives the ease-in-out something to animate; setting both
  // together would snap straight to the end.
  pendingOpenFrame = requestAnimationFrame(() => backdrop.classList.add("is-open"));
  closeButton.focus();
}

/**
 * Close the share modal. Safe to call whether or not it is open, but only
 * reachable from a page that renders one -- the wiring below is the sole
 * caller, and it is installed only when the markup exists.
 * @returns {void}
 */
export function closeShareModal() {
  shareModalOpen = false;
  // Cancels the frame `openShareModal` queued. Without this a dismissal inside
  // that frame would be reversed the moment it ran, leaving the modal open
  // with nothing left to close it.
  cancelAnimationFrame(pendingOpenFrame);
  backdrop.classList.remove("is-open");
  note.textContent = "";
  // Hiding immediately would cut the exit animation off at its first frame, so
  // the element stays displayed until the transition it just started ends.
  // `transitionend` alone is not enough to rely on -- it never fires when the
  // motion is suppressed (reduced-motion, a background tab), which is why the
  // timeout below is the one that actually guarantees `hidden`. Reopening in
  // the meantime wins: this only hides what is still meant to be closed.
  globalThis.setTimeout(() => {
    if (!shareModalOpen) backdrop.hidden = true;
  }, MODAL_EXIT_MS);
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
