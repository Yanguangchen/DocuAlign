/**
 * @file observability.test.js
 * @description Tests for the page-level observability bootstrap: global error
 * handlers, idempotent installation, and the support diagnostics handle.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearRecentEvents, getRecentEvents, sessionId } from "./logger.js";
import { initObservability, replayEarlyEvents } from "./observability.js";

describe("initObservability", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    clearRecentEvents();
    initObservability();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is idempotent: a second call does not double-register handlers", () => {
    initObservability();
    globalThis.dispatchEvent(new Event("error"));
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("logs uncaught exceptions from the global error event", () => {
    globalThis.dispatchEvent(new Event("error"));

    const events = getRecentEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      level: "error",
      message: "Uncaught exception",
      feature: "Observability",
      category: "UncaughtException",
    });
  });

  it("records the script source location when the error event provides one", () => {
    globalThis.dispatchEvent(
      new ErrorEvent("error", {
        error: new Error("boom"),
        filename: "https://example.test/app.js",
        lineno: 12,
        colno: 34,
      }),
    );

    const events = getRecentEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      errorMessage: "boom",
      source: "https://example.test/app.js:12:34",
    });
  });

  it("captures resource-load failures without retaining URL query data", () => {
    const image = document.createElement("img");
    image.src = "https://cdn.example.test/report.png?token=secret#preview";
    document.body.append(image);
    image.dispatchEvent(new Event("error"));

    const stylesheet = document.createElement("link");
    stylesheet.href = "https://cdn.example.test/theme.css?cache=123";
    document.head.append(stylesheet);
    stylesheet.dispatchEvent(new Event("error"));

    expect(getRecentEvents()).toEqual([
      expect.objectContaining({
        level: "error",
        message: "Resource failed to load",
        category: "ResourceLoadFailure",
        resourceType: "img",
        source: "https://cdn.example.test/report.png",
      }),
      expect.objectContaining({
        level: "error",
        message: "Resource failed to load",
        category: "ResourceLoadFailure",
        resourceType: "link",
        source: "https://cdn.example.test/theme.css",
      }),
    ]);
  });

  it("logs unhandled promise rejections", () => {
    globalThis.dispatchEvent(new Event("unhandledrejection"));

    const events = getRecentEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      level: "error",
      message: "Unhandled promise rejection",
      category: "UnhandledRejection",
    });
  });

  it("logs browser connectivity changes", () => {
    globalThis.dispatchEvent(new Event("offline"));
    globalThis.dispatchEvent(new Event("online"));

    expect(getRecentEvents()).toEqual([
      expect.objectContaining({
        level: "warn",
        message: "Browser went offline",
        category: "ConnectivityChange",
        online: false,
      }),
      expect.objectContaining({
        level: "info",
        message: "Browser is online",
        category: "ConnectivityChange",
        online: true,
      }),
    ]);
  });

  it("replays queued startup failures through the structured logger", () => {
    const stop = vi.fn();
    const takeEvents = vi.fn(() => [{
      timestamp: "2026-07-12T01:02:03.000Z",
      sessionId: "early-1",
      message: "Early module failure",
      errorMessage: "module failed",
      feature: "ObservabilityBootstrap",
      category: "EarlyUncaughtException",
      source: "https://example.test/startup.js",
    }]);

    replayEarlyEvents({ stop, takeEvents });

    expect(stop).toHaveBeenCalledOnce();
    expect(takeEvents).toHaveBeenCalledOnce();
    expect(getRecentEvents()).toEqual([
      expect.objectContaining({
        level: "error",
        message: "Early module failure",
        errorMessage: "module failed",
        operation: "bootstrap.replay",
        observedAt: "2026-07-12T01:02:03.000Z",
        earlySessionId: "early-1",
      }),
    ]);
  });

  it("exposes the diagnostics handle for support", () => {
    expect(globalThis.docuAlignDiagnostics.sessionId).toBe(sessionId);
    expect(globalThis.docuAlignDiagnostics.getRecentEvents).toBeTypeOf("function");
    expect(globalThis.docuAlignDiagnostics.getSnapshot).toBeTypeOf("function");

    const snapshot = globalThis.docuAlignDiagnostics.getSnapshot();
    expect(snapshot).toMatchObject({
      sessionId,
      page: globalThis.location.pathname,
      online: navigator.onLine,
      visibilityState: document.visibilityState,
      events: [],
    });
    expect(snapshot.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("exposes a frozen structured-logger bridge to classic workspace scripts", async () => {
    const bridge = globalThis.docuAlignLogger;

    expect(Object.isFrozen(bridge)).toBe(true);
    expect(bridge).toMatchObject({
      logError: expect.any(Function),
      logInfo: expect.any(Function),
      logWarn: expect.any(Function),
      trackOperation: expect.any(Function),
    });

    bridge.logInfo("Classic bridge event", {
      feature: "WorkbookPipeline",
      function: "test",
      operation: "bridge.logInfo",
      category: "TestTelemetry",
    });
    await bridge.trackOperation(
      "Classic bridge operation",
      {
        feature: "WorkbookPipeline",
        function: "test",
        operation: "bridge.trackOperation",
      },
      async () => "complete",
    );

    expect(getRecentEvents()).toEqual([
      expect.objectContaining({
        message: "Classic bridge event",
        category: "TestTelemetry",
      }),
      expect.objectContaining({
        message: "Classic bridge operation started",
        outcome: "started",
      }),
      expect.objectContaining({
        message: "Classic bridge operation succeeded",
        outcome: "success",
      }),
    ]);
  });
});
