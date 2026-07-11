/**
 * @file observability.js
 * @description Page-level observability bootstrap. Installs global handlers so
 * uncaught exceptions and unhandled promise rejections are logged through the
 * structured logger instead of dying silently in the console, and exposes a
 * small diagnostics handle (`globalThis.docuAlignDiagnostics`) so support can
 * read the session id and recent log events from any page.
 */
import { getRecentEvents, logError, logInfo, sessionId } from "./logger.js";

let installed = false;

/**
 * Install global error handlers and the diagnostics handle. Idempotent, so
 * every page entry module can call it without double-registering.
 */
export function initObservability() {
  if (installed) return;
  installed = true;

  globalThis.addEventListener("error", (event) => {
    logError("Uncaught exception", event.error ?? event.message, {
      feature: "Observability",
      operation: "window.onerror",
      category: "UncaughtException",
      source: event.filename
        ? `${event.filename}:${event.lineno}:${event.colno}`
        : undefined,
    });
  });

  globalThis.addEventListener("unhandledrejection", (event) => {
    logError("Unhandled promise rejection", event.reason, {
      feature: "Observability",
      operation: "window.onunhandledrejection",
      category: "UnhandledRejection",
    });
  });

  globalThis.docuAlignDiagnostics = { sessionId, getRecentEvents };

  logInfo("Observability initialised", {
    feature: "Observability",
    operation: "initObservability",
  });
}
