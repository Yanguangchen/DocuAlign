/**
 * @file early-observability.js
 * @description Classic-script error bootstrap for the interval before ES
 * modules load. It works over `file://`, queues startup failures, and exposes
 * lightweight diagnostics until the full structured observer takes over.
 */
(() => {
  const sessionId = Math.random().toString(36).slice(2, 10);
  const events = [];
  let listening = true;

  function sourceWithoutQuery(source) {
    return String(source).split(/[?#]/, 1)[0];
  }

  function record(message, error, context) {
    const errorDetails = error
      ? {
          errorCode: error.code,
          errorMessage: error.message ?? String(error),
        }
      : {};
    events.push(Object.freeze({
      ...context,
      ...errorDetails,
      timestamp: new Date().toISOString(),
      level: "error",
      sessionId,
      page: globalThis.location.pathname,
      message,
    }));
  }

  function handleError(event) {
    const resource = event.target instanceof globalThis.Element ? event.target : null;
    if (resource) {
      const source = resource.getAttribute("src") ?? resource.getAttribute("href");
      if (source) {
        record("Resource failed to load", event.error, {
          feature: "ObservabilityBootstrap",
          function: "handleError",
          operation: "window.onerror",
          category: "ResourceLoadFailure",
          resourceType: resource.tagName.toLowerCase(),
          source: sourceWithoutQuery(source),
        });
        return;
      }
    }

    record("Uncaught exception before observability initialised", event.error ?? event.message, {
      feature: "ObservabilityBootstrap",
      function: "handleError",
      operation: "window.onerror",
      category: "EarlyUncaughtException",
      source: event.filename ? sourceWithoutQuery(event.filename) : undefined,
    });
  }

  function handleUnhandledRejection(event) {
    record("Unhandled rejection before observability initialised", event.reason, {
      feature: "ObservabilityBootstrap",
      function: "handleUnhandledRejection",
      operation: "window.onunhandledrejection",
      category: "EarlyUnhandledRejection",
    });
  }

  function getRecentEvents() {
    return events.map((event) => ({ ...event }));
  }

  function getSnapshot() {
    return {
      generatedAt: new Date().toISOString(),
      mode: "bootstrap",
      sessionId,
      page: globalThis.location.pathname,
      events: getRecentEvents(),
    };
  }

  function stop() {
    if (!listening) return;
    globalThis.removeEventListener("error", handleError, true);
    globalThis.removeEventListener("unhandledrejection", handleUnhandledRejection);
    listening = false;
  }

  function takeEvents() {
    const captured = getRecentEvents();
    events.length = 0;
    return captured;
  }

  globalThis.addEventListener("error", handleError, true);
  globalThis.addEventListener("unhandledrejection", handleUnhandledRejection);

  globalThis.docuAlignEarlyObservability = Object.freeze({
    sessionId,
    getRecentEvents,
    getSnapshot,
    stop,
    takeEvents,
  });
  globalThis.docuAlignDiagnostics = Object.freeze({
    sessionId,
    getRecentEvents,
    getSnapshot,
  });
})();
