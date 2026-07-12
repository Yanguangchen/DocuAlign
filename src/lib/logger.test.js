/**
 * @file logger.test.js
 * @description Tests for the central structured logger: event shape, level
 * filtering, the recent-events buffer, subscribers, and operation timing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearRecentEvents,
  getRecentEvents,
  logDebug,
  logError,
  logInfo,
  logWarn,
  onLogEvent,
  sessionId,
  setMinimumLogLevel,
  trackOperation,
} from "./logger.js";

describe("logger", () => {
  beforeEach(() => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    setMinimumLogLevel("debug");
    clearRecentEvents();
  });

  afterEach(() => {
    setMinimumLogLevel("info");
    vi.restoreAllMocks();
  });

  it("emits structured events with the shared session id and prefix", () => {
    logInfo("Something happened", { feature: "Test", operation: "unit" });

    expect(console.info).toHaveBeenCalledTimes(1);
    const [message, event] = console.info.mock.calls[0];
    expect(message).toBe("[DocuAlign] Something happened");
    expect(event).toMatchObject({
      level: "info",
      sessionId,
      message: "Something happened",
      feature: "Test",
      operation: "unit",
    });
    expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("prevents caller context from overwriting core event identity", () => {
    logInfo("Trusted message", {
      level: "error",
      message: "Spoofed message",
      sessionId: "spoofed-session",
      timestamp: "not-a-date",
    });

    const [message, event] = console.info.mock.calls[0];
    expect(message).toBe("[DocuAlign] Trusted message");
    expect(event).toMatchObject({
      level: "info",
      message: "Trusted message",
      sessionId,
    });
    expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("routes each level to the matching console method", () => {
    logDebug("d");
    logInfo("i");
    logWarn("w");
    logError("e");

    expect(console.debug).toHaveBeenCalledTimes(1);
    expect(console.info).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("supplies classification defaults when a caller omits context", () => {
    logInfo("Unclassified event");

    expect(console.info.mock.calls[0][1]).toMatchObject({
      feature: "Application",
      function: "unknown",
      operation: "unknown",
      category: "General",
    });
  });

  it("attaches error details and passes the raw error to the console", () => {
    const failure = Object.assign(new Error("boom"), { code: "permission-denied" });
    logError("Write failed", failure, { feature: "Test" });

    const [, error, event] = console.error.mock.calls[0];
    expect(error).toBe(failure);
    expect(event).toMatchObject({
      errorCode: "permission-denied",
      errorMessage: "boom",
      feature: "Test",
    });
  });

  it("describes non-Error thrown values without assuming Error shape", () => {
    logError("Write failed", "plain string failure");

    const [, , event] = console.error.mock.calls[0];
    expect(event.errorMessage).toBe("plain string failure");
    expect(event.errorCode).toBeUndefined();
  });

  it("suppresses events below the minimum level", () => {
    setMinimumLogLevel("error");
    logDebug("d");
    logInfo("i");
    logWarn("w");
    logError("e");

    expect(console.warn).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(getRecentEvents()).toHaveLength(1);
  });

  it("rejects unknown levels", () => {
    expect(() => setMinimumLogLevel("verbose")).toThrow(TypeError);
  });

  it("buffers recent events and caps the buffer size", () => {
    for (let index = 0; index < 60; index += 1) {
      logInfo(`event ${index}`);
    }

    const events = getRecentEvents();
    expect(events).toHaveLength(50);
    expect(events[0].message).toBe("event 10");
    expect(events.at(-1).message).toBe("event 59");
  });

  it("returns copies from getRecentEvents so callers cannot mutate the buffer", () => {
    logInfo("original");
    getRecentEvents()[0].message = "tampered";
    expect(getRecentEvents()[0].message).toBe("original");
  });

  it("notifies subscribers and supports unsubscribe", () => {
    const seen = [];
    const unsubscribe = onLogEvent((event) => seen.push(event.message));

    logInfo("first");
    unsubscribe();
    logInfo("second");

    expect(seen).toEqual(["first"]);
  });

  it("keeps logging when a subscriber throws", () => {
    const unsubscribe = onLogEvent(() => {
      throw new Error("broken sink");
    });

    expect(() => logInfo("still works")).not.toThrow();
    expect(console.info).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  describe("trackOperation", () => {
    const context = { feature: "Test", operation: "firestore.getDocs" };

    it("returns the result and logs a success event with duration", async () => {
      const result = await trackOperation("Load data", context, async () => 42);

      expect(result).toBe(42);
      expect(console.info).toHaveBeenCalledTimes(2);
      const [, startedEvent] = console.info.mock.calls[0];
      const [message, event] = console.info.mock.calls[1];
      expect(message).toBe("[DocuAlign] Load data succeeded");
      expect(event).toMatchObject({ ...context, outcome: "success" });
      expect(event.category).toBe("OperationLifecycle");
      expect(event.durationMs).toBeTypeOf("number");
      expect(startedEvent).toMatchObject({
        ...context,
        outcome: "started",
        category: "OperationLifecycle",
        operationId: event.operationId,
      });
    });

    it("logs a failure event and rethrows", async () => {
      const failure = Object.assign(new Error("nope"), { code: "unavailable" });

      await expect(
        trackOperation("Load data", context, () => Promise.reject(failure)),
      ).rejects.toBe(failure);

      const [message, error, event] = console.error.mock.calls[0];
      expect(message).toBe("[DocuAlign] Load data failed");
      expect(error).toBe(failure);
      expect(event).toMatchObject({
        ...context,
        outcome: "failure",
        category: "unavailable",
      });
      expect(event.durationMs).toBeTypeOf("number");
      expect(console.info.mock.calls[0][1]).toMatchObject({
        ...context,
        outcome: "started",
        operationId: event.operationId,
      });
    });

    it("prefers an explicit category over the error code", async () => {
      await expect(
        trackOperation(
          "Load data",
          { ...context, category: "DatabaseReadFailure" },
          () => Promise.reject(new Error("nope")),
        ),
      ).rejects.toThrow("nope");

      const [, , event] = console.error.mock.calls[0];
      expect(event.category).toBe("DatabaseReadFailure");
    });

    it("records configured expected failures as warnings and still rethrows", async () => {
      const denial = Object.assign(new Error("denied"), {
        code: "permission-denied",
      });

      await expect(
        trackOperation(
          "Probe access",
          { ...context, category: "AuthorizationProbe" },
          () => Promise.reject(denial),
          { expectedErrorCodes: ["permission-denied"] },
        ),
      ).rejects.toBe(denial);

      expect(console.error).not.toHaveBeenCalled();
      const [message, event] = console.warn.mock.calls[0];
      expect(message).toBe("[DocuAlign] Probe access rejected");
      expect(event).toMatchObject({
        errorCode: "permission-denied",
        errorMessage: "denied",
        category: "AuthorizationProbe",
        outcome: "rejected",
      });
      expect(event.durationMs).toBeTypeOf("number");
      expect(console.info.mock.calls[0][1].operationId).toBe(event.operationId);
    });
  });
});
