/**
 * @file observability.test.js
 * @description Tests for the page-level observability bootstrap: global error
 * handlers, idempotent installation, and the support diagnostics handle.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearRecentEvents, getRecentEvents, sessionId } from "./logger.js";
import { initObservability } from "./observability.js";

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

  it("exposes the diagnostics handle for support", () => {
    expect(globalThis.docuAlignDiagnostics.sessionId).toBe(sessionId);
    expect(globalThis.docuAlignDiagnostics.getRecentEvents).toBeTypeOf("function");
  });
});
