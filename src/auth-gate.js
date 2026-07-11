/**
 * @file auth-gate.js
 * @description Authentication gatekeeper for DocuAlign workspace pages.
 * Handles Google OAuth sign-in popups, session persistence, and performs an active
 * Firestore access probe (`docuAlignReports/access-probe`) to verify whether the user
 * belongs to the approved CubeSync staff allowlist before rendering protected UI.
 */
import {
  browserLocalPersistence,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "./lib/firebase.js";
import { logError, logInfo, logWarn } from "./lib/logger.js";
import { initObservability } from "./lib/observability.js";

initObservability();

const authGate = document.querySelector("#auth-gate");
const protectedApp = document.querySelector("#protected-app");
const signInButton = document.querySelector("#google-sign-in");
const signOutButton = document.querySelector("#sign-out");
const authMessage = document.querySelector("#auth-message");
const userEmail = document.querySelector("#auth-user-email");
const provider = new GoogleAuthProvider();

provider.setCustomParameters({ prompt: "select_account" });

export function showGate(message = "Use an approved CubeSync Google account to continue.", isError = false) {
  protectedApp.hidden = true;
  authGate.hidden = false;
  authMessage.textContent = message;
  authMessage.classList.toggle("is-error", isError);
  signInButton.disabled = false;
}

export function showApp(user) {
  authGate.hidden = true;
  protectedApp.hidden = false;
  userEmail.textContent = user.email;
}

export async function hasDocuAlignAccess(user) {
  if (!user?.emailVerified) {
    logWarn("Access check denied: email not verified", {
      feature: "AuthGate",
      function: "hasDocuAlignAccess",
      operation: "verifyEmail",
      rule: "emailVerified must be true",
      safeIdentifier: user?.uid ? `uid:${user.uid}` : "anonymous",
    });
    return false;
  }

  try {
    await getDoc(doc(db, "docuAlignReports", "access-probe"));
    return true;
  } catch (error) {
    if (error?.code === "permission-denied") {
      logWarn("Access check denied: Firestore permission-denied", {
        feature: "AuthGate",
        function: "hasDocuAlignAccess",
        operation: "firestore.getDoc",
        target: "docuAlignReports/access-probe",
        safeIdentifier: user?.uid ? `uid:${user.uid}` : "anonymous",
      });
      return false;
    }
    logError("Access probe verification failure", error, {
      feature: "AuthGate",
      function: "hasDocuAlignAccess",
      operation: "firestore.getDoc",
      target: "docuAlignReports/access-probe",
      category: error?.code || "DatabaseReadFailure",
      safeIdentifier: user?.uid ? `uid:${user.uid}` : "anonymous",
    });
    throw error;
  }
}

signInButton.addEventListener("click", async () => {
  signInButton.disabled = true;
  authMessage.textContent = "Opening Google sign-in...";
  authMessage.classList.remove("is-error");

  try {
    await setPersistence(auth, browserLocalPersistence);
    await signInWithPopup(auth, provider);
  } catch (error) {
    if (error?.code === "auth/popup-closed-by-user") {
      logInfo("Sign-in popup cancelled by user", {
        feature: "AuthGate",
        function: "signInButton.onClick",
        operation: "signInWithPopup",
        category: "UserCancellation",
      });
      showGate("Google sign-in was cancelled.");
      return;
    }

    logError("Google sign-in failure", error, {
      feature: "AuthGate",
      function: "signInButton.onClick",
      operation: "signInWithPopup",
      category: error?.code || "AuthenticationFailure",
    });
    showGate("Google sign-in failed. Check the authorized domain and try again.", true);
  }
});

signOutButton.addEventListener("click", async () => {
  signOutButton.disabled = true;
  try {
    await signOut(auth);
  } catch (error) {
    logError("Sign out failure", error, {
      feature: "AuthGate",
      function: "signOutButton.onClick",
      operation: "signOut",
      category: error?.code || "SignOutFailure",
    });
  } finally {
    signOutButton.disabled = false;
  }
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    showGate();
    return;
  }

  try {
    if (!(await hasDocuAlignAccess(user))) {
      await signOut(auth);
      showGate("This Google account does not have CubeSync access.", true);
      return;
    }

    showApp(user);
  } catch (error) {
    logError("Verification failure during auth state change", error, {
      feature: "AuthGate",
      function: "onAuthStateChanged",
      operation: "hasDocuAlignAccess",
      category: error?.code || "VerificationFailure",
      safeIdentifier: user?.uid ? `uid:${user.uid}` : "anonymous",
    });
    await signOut(auth);
    showGate("Access could not be verified. Check your connection and try again.", true);
  }
});
