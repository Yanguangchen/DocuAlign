import { describe, it, expect, vi, beforeEach } from "vitest";

let authStateCallback = null;
const mockSignInWithPopup = vi.fn();
const mockSignOut = vi.fn();
const mockSetPersistence = vi.fn();

vi.mock("firebase/auth", () => {
  class MockProvider {
    setCustomParameters = vi.fn();
  }
  return {
    GoogleAuthProvider: MockProvider,
    browserLocalPersistence: "LOCAL",
    onAuthStateChanged: vi.fn((auth, cb) => {
      authStateCallback = cb;
      return vi.fn();
    }),
    setPersistence: (...args) => mockSetPersistence(...args),
    signInWithPopup: (...args) => mockSignInWithPopup(...args),
    signOut: (...args) => mockSignOut(...args),
  };
});

const mockGetDoc = vi.fn();
vi.mock("firebase/firestore", () => ({
  doc: vi.fn((db, coll, id) => ({ db, coll, id })),
  getDoc: (...args) => mockGetDoc(...args),
}));

vi.mock("./lib/firebase.js", () => ({
  auth: {},
  db: {},
}));

describe("auth-gate module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    document.body.innerHTML = `
      <section id="auth-gate" hidden>
        <p id="auth-message"></p>
        <button id="google-sign-in"></button>
      </section>
      <div id="protected-app" hidden>
        <span id="auth-user-email"></span>
        <button id="sign-out"></button>
      </div>
    `;
  });

  it("exports showGate setting messages and visibility", async () => {
    const { showGate } = await import("./auth-gate.js");
    showGate("Test message", true);
    expect(document.querySelector("#auth-gate").hidden).toBe(false);
    expect(document.querySelector("#protected-app").hidden).toBe(true);
    const msg = document.querySelector("#auth-message");
    expect(msg.textContent).toBe("Test message");
    expect(msg.classList.contains("is-error")).toBe(true);
    expect(document.querySelector("#google-sign-in").disabled).toBe(false);
  });

  it("exports showApp displaying protected app and email", async () => {
    const { showApp } = await import("./auth-gate.js");
    showApp({ email: "user@example.com" });
    expect(document.querySelector("#auth-gate").hidden).toBe(true);
    expect(document.querySelector("#protected-app").hidden).toBe(false);
    expect(document.querySelector("#auth-user-email").textContent).toBe("user@example.com");
  });

  it("exports hasDocuAlignAccess testing email verification and firestore probe", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { hasDocuAlignAccess } = await import("./auth-gate.js");
    expect(await hasDocuAlignAccess(null)).toBe(false);
    expect(await hasDocuAlignAccess({ emailVerified: false })).toBe(false);
    expect(warnSpy).toHaveBeenCalled();

    mockGetDoc.mockResolvedValueOnce({ exists: () => true });
    expect(await hasDocuAlignAccess({ emailVerified: true })).toBe(true);

    mockGetDoc.mockRejectedValueOnce({ code: "permission-denied" });
    expect(await hasDocuAlignAccess({ emailVerified: true })).toBe(false);

    mockGetDoc.mockRejectedValueOnce(new Error("Fatal DB Error"));
    await expect(hasDocuAlignAccess({ emailVerified: true })).rejects.toThrow("Fatal DB Error");
    expect(errorSpy).toHaveBeenCalled();
  });

  it("logs uid-scoped safe identifiers when the user has a uid", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { hasDocuAlignAccess } = await import("./auth-gate.js");

    expect(await hasDocuAlignAccess({ emailVerified: false, uid: "u-1" })).toBe(false);
    expect(warnSpy).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ safeIdentifier: "uid:u-1" })
    );

    mockGetDoc.mockRejectedValueOnce({ code: "permission-denied" });
    expect(await hasDocuAlignAccess({ emailVerified: true, uid: "u-2" })).toBe(false);
    expect(warnSpy).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ safeIdentifier: "uid:u-2" })
    );

    mockGetDoc.mockRejectedValueOnce(new Error("Fatal DB Error"));
    await expect(hasDocuAlignAccess({ emailVerified: true, uid: "u-3" })).rejects.toThrow();
    expect(errorSpy).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.any(Error),
      expect.objectContaining({ safeIdentifier: "uid:u-3" })
    );
  });

  it("handles successful sign-in button click", async () => {
    mockSetPersistence.mockResolvedValueOnce();
    mockSignInWithPopup.mockResolvedValueOnce({});
    await import("./auth-gate.js");

    const btn = document.querySelector("#google-sign-in");
    btn.click();
    expect(btn.disabled).toBe(true);
    expect(document.querySelector("#auth-message").textContent).toBe("Opening Google sign-in...");

    await new Promise((r) => setTimeout(r, 15));
    expect(mockSetPersistence).toHaveBeenCalled();
    expect(mockSignInWithPopup).toHaveBeenCalled();
  });

  it("handles sign-in popup cancelled by user", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    mockSetPersistence.mockRejectedValueOnce({ code: "auth/popup-closed-by-user" });
    await import("./auth-gate.js");

    const btn = document.querySelector("#google-sign-in");
    btn.click();

    await new Promise((r) => setTimeout(r, 15));
    expect(document.querySelector("#auth-message").textContent).toBe("Google sign-in was cancelled.");
    expect(infoSpy).toHaveBeenCalled();
  });

  it("handles general sign-in failure", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockSetPersistence.mockRejectedValueOnce(new Error("Auth Error"));
    await import("./auth-gate.js");

    const btn = document.querySelector("#google-sign-in");
    btn.click();

    await new Promise((r) => setTimeout(r, 15));
    expect(document.querySelector("#auth-message").textContent).toBe(
      "Google sign-in failed. Check the authorized domain and try again."
    );
    expect(errorSpy).toHaveBeenCalled();
  });

  it("handles sign-out button click", async () => {
    mockSignOut.mockResolvedValueOnce();
    await import("./auth-gate.js");

    const btn = document.querySelector("#sign-out");
    btn.click();

    await new Promise((r) => setTimeout(r, 15));
    expect(mockSignOut).toHaveBeenCalled();
    expect(btn.disabled).toBe(false);
  });

  it("handles sign-out failure gracefully", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockSignOut.mockRejectedValueOnce(new Error("SignOut error"));
    await import("./auth-gate.js");

    const btn = document.querySelector("#sign-out");
    btn.click();

    await new Promise((r) => setTimeout(r, 15));
    expect(errorSpy).toHaveBeenCalledWith(
      "[DocuAlign] Sign out failure",
      expect.any(Error),
      expect.objectContaining({ operation: "signOut" })
    );
    expect(btn.disabled).toBe(false);
  });

  it("handles onAuthStateChanged when user is null", async () => {
    await import("./auth-gate.js");
    if (authStateCallback) authStateCallback(null);

    await new Promise((r) => setTimeout(r, 15));
    expect(document.querySelector("#auth-gate").hidden).toBe(false);
  });

  it("handles onAuthStateChanged when user has access", async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => true });
    await import("./auth-gate.js");
    if (authStateCallback) authStateCallback({ emailVerified: true, email: "ok@example.com" });

    await new Promise((r) => setTimeout(r, 15));
    expect(document.querySelector("#protected-app").hidden).toBe(false);
  });

  it("handles onAuthStateChanged when user lacks access", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockGetDoc.mockRejectedValueOnce({ code: "permission-denied" });
    mockSignOut.mockResolvedValueOnce();
    await import("./auth-gate.js");
    if (authStateCallback) authStateCallback({ emailVerified: true, email: "no@example.com" });

    await new Promise((r) => setTimeout(r, 15));
    expect(mockSignOut).toHaveBeenCalled();
    expect(document.querySelector("#auth-message").textContent).toBe(
      "This Google account does not have CubeSync access."
    );
    expect(warnSpy).toHaveBeenCalled();
  });

  it("handles onAuthStateChanged verification failure error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetDoc.mockRejectedValueOnce(new Error("Network Error"));
    mockSignOut.mockResolvedValueOnce();
    await import("./auth-gate.js");
    if (authStateCallback) authStateCallback({ emailVerified: true, email: "err@example.com" });

    await new Promise((r) => setTimeout(r, 15));
    expect(mockSignOut).toHaveBeenCalled();
    expect(document.querySelector("#auth-message").textContent).toBe(
      "Access could not be verified. Check your connection and try again."
    );
    expect(errorSpy).toHaveBeenCalled();
  });

  it("logs a uid-scoped identifier on verification failure for users with a uid", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetDoc.mockRejectedValueOnce(new Error("Network Error"));
    mockSignOut.mockResolvedValueOnce();
    await import("./auth-gate.js");
    if (authStateCallback) {
      authStateCallback({ emailVerified: true, email: "err@example.com", uid: "u-err" });
    }

    await new Promise((r) => setTimeout(r, 15));
    expect(errorSpy).toHaveBeenCalledWith(
      "[DocuAlign] Verification failure during auth state change",
      expect.any(Error),
      expect.objectContaining({ safeIdentifier: "uid:u-err" })
    );
  });
});
