/**
 * @file early-observability.test.js
 * @description Covers the classic-script startup observer used before the full
 * structured observability module initializes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("early observability bootstrap", () => {
  beforeEach(() => {
    vi.resetModules();
    delete globalThis.docuAlignEarlyObservability;
    delete globalThis.docuAlignDiagnostics;
  });

  afterEach(() => {
    globalThis.docuAlignEarlyObservability?.stop();
    delete globalThis.docuAlignEarlyObservability;
    delete globalThis.docuAlignDiagnostics;
  });

  it("captures startup exceptions, resources, and rejections for later replay", async () => {
    await import("./early-observability.js");
    const observer = globalThis.docuAlignEarlyObservability;

    globalThis.dispatchEvent(new ErrorEvent("error", {
      error: Object.assign(new Error("startup boom"), { code: "startup" }),
      filename: "https://example.test/app.js?token=secret",
    }));

    const image = document.createElement("img");
    image.setAttribute("src", "https://cdn.test/image.png?secret=yes");
    document.body.append(image);
    image.dispatchEvent(new Event("error"));

    const stylesheet = document.createElement("link");
    stylesheet.setAttribute("href", "https://cdn.test/theme.css#v2");
    document.head.append(stylesheet);
    stylesheet.dispatchEvent(new Event("error"));

    const sourceLessElement = document.createElement("div");
    document.body.append(sourceLessElement);
    sourceLessElement.dispatchEvent(new ErrorEvent("error", { message: "element error" }));

    const rejection = new Event("unhandledrejection");
    Object.defineProperty(rejection, "reason", { value: "plain rejection" });
    globalThis.dispatchEvent(rejection);

    const events = observer.getRecentEvents();
    expect(events).toHaveLength(5);
    expect(events[0]).toMatchObject({
      category: "EarlyUncaughtException",
      errorCode: "startup",
      errorMessage: "startup boom",
      source: "https://example.test/app.js",
    });
    expect(events[1]).toMatchObject({
      category: "ResourceLoadFailure",
      resourceType: "img",
      source: "https://cdn.test/image.png",
    });
    expect(events[2]).toMatchObject({
      category: "ResourceLoadFailure",
      resourceType: "link",
      source: "https://cdn.test/theme.css",
    });
    expect(events[3]).toMatchObject({
      category: "EarlyUncaughtException",
      errorMessage: "element error",
    });
    expect(events[4]).toMatchObject({
      category: "EarlyUnhandledRejection",
      errorMessage: "plain rejection",
    });

    events[0].message = "tampered";
    expect(observer.getRecentEvents()[0].message).not.toBe("tampered");
    expect(observer.getSnapshot()).toMatchObject({
      mode: "bootstrap",
      sessionId: observer.sessionId,
      page: globalThis.location.pathname,
      events: expect.any(Array),
    });

    expect(observer.takeEvents()).toHaveLength(5);
    expect(observer.getRecentEvents()).toEqual([]);
    observer.stop();
    observer.stop();
    globalThis.dispatchEvent(new Event("error"));
    expect(observer.getRecentEvents()).toEqual([]);
  });
});
