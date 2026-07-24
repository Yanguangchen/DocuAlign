/**
 * @file observability.js
 * @description Page-level observability bootstrap. Installs global handlers so
 * uncaught exceptions and unhandled promise rejections are logged through the
 * structured logger instead of dying silently in the console, and exposes a
 * small diagnostics handle (`globalThis.docuAlignDiagnostics`) so support can
 * read a support snapshot with session, page, connectivity, and recent events.
 */
import {
  getRecentEvents,
  logError,
  logInfo,
  logWarn,
  sessionId,
  trackOperation,
} from "./logger.js";

let installed = false;
const loggerBridge = Object.freeze({
  logError,
  logInfo,
  logWarn,
  trackOperation,
});

function sourceWithoutQuery(source) {
  return String(source).split(/[?#]/, 1)[0];
}

/**
 * Build a point-in-time support snapshot around the recent structured log tail.
 * @returns {object} Serializable diagnostics suitable for a support ticket.
 */
export function getDiagnosticSnapshot() {
  return {
    generatedAt: new Date().toISOString(),
    sessionId,
    page: globalThis.location.pathname,
    online: globalThis.navigator.onLine,
    visibilityState: globalThis.document.visibilityState,
    events: getRecentEvents(),
  };
}

/**
 * Stop the classic startup observer and replay its queued failures through the
 * structured logger so early and steady-state events share the same sink.
 * @param {object} [earlyObserver]
 */
export function replayEarlyEvents(
  earlyObserver = globalThis.docuAlignEarlyObservability,
) {
  if (!earlyObserver) return;

  earlyObserver.stop();
  for (const event of earlyObserver.takeEvents()) {
    logError(event.message, event.errorMessage, {
      feature: event.feature,
      function: "replayEarlyEvents",
      operation: "bootstrap.replay",
      category: event.category,
      source: event.source,
      resourceType: event.resourceType,
      observedAt: event.timestamp,
      earlySessionId: event.sessionId,
    });
  }
}

/**
 * Install global error handlers and the diagnostics handle. Idempotent, so
 * every page entry module can call it without double-registering.
 */
export function initObservability() {
  // Classic workspace scripts cannot import ES modules, so expose only the
  // central logger's public methods through a frozen, PII-neutral bridge.
  globalThis.docuAlignLogger = loggerBridge;
  if (installed) return;
  installed = true;
  replayEarlyEvents();

  globalThis.addEventListener("error", (event) => {
    const resource = event.target instanceof globalThis.Element ? event.target : null;
    const resourceSource = resource?.currentSrc || resource?.src || resource?.href;

    if (resource && resourceSource) {
      logError("Resource failed to load", event.error, {
        feature: "Observability",
        function: "handleGlobalError",
        operation: "window.onerror",
        category: "ResourceLoadFailure",
        resourceType: resource.tagName.toLowerCase(),
        source: sourceWithoutQuery(resourceSource),
      });
      return;
    }

    logError("Uncaught exception", event.error ?? event.message, {
      feature: "Observability",
      function: "handleGlobalError",
      operation: "window.onerror",
      category: "UncaughtException",
      source: event.filename
        ? `${sourceWithoutQuery(event.filename)}:${event.lineno}:${event.colno}`
        : undefined,
    });
  }, true);

  globalThis.addEventListener("unhandledrejection", (event) => {
    logError("Unhandled promise rejection", event.reason, {
      feature: "Observability",
      function: "handleUnhandledRejection",
      operation: "window.onunhandledrejection",
      category: "UnhandledRejection",
    });
  });

  globalThis.addEventListener("offline", () => {
    logWarn("Browser went offline", {
      feature: "Observability",
      function: "handleConnectivityChange",
      operation: "window.offline",
      category: "ConnectivityChange",
      online: false,
    });
  });

  globalThis.addEventListener("online", () => {
    logInfo("Browser is online", {
      feature: "Observability",
      function: "handleConnectivityChange",
      operation: "window.online",
      category: "ConnectivityChange",
      online: true,
    });
  });

  globalThis.docuAlignDiagnostics = {
    sessionId,
    getRecentEvents,
    getSnapshot: getDiagnosticSnapshot,
  };

  logInfo("Observability initialised", {
    feature: "Observability",
    function: "initObservability",
    operation: "initObservability",
    category: "Lifecycle",
  });
}
