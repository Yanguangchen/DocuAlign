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
import { logWarn, trackOperation } from "./lib/logger.js";
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
    await trackOperation(
      "Access probe",
      {
        feature: "AuthGate",
        function: "hasDocuAlignAccess",
        operation: "firestore.getDoc",
        category: "AuthorizationProbe",
        target: "docuAlignReports/access-probe",
        safeIdentifier: user?.uid ? `uid:${user.uid}` : "anonymous",
      },
      () => getDoc(doc(db, "docuAlignReports", "access-probe")),
      { expectedErrorCodes: ["permission-denied"] },
    );
    return true;
  } catch (error) {
    if (error?.code === "permission-denied") {
      return false;
    }
    throw error;
  }
}

function trackedSignOut(caller) {
  return trackOperation(
    "Sign out",
    {
      feature: "AuthGate",
      function: caller,
      operation: "firebaseAuth.signOut",
      category: "Authentication",
    },
    () => signOut(auth),
  );
}

signInButton.addEventListener("click", async () => {
  signInButton.disabled = true;
  authMessage.textContent = "Opening Google sign-in...";
  authMessage.classList.remove("is-error");

  try {
    await trackOperation(
      "Google sign-in",
      {
        feature: "AuthGate",
        function: "signInButton.onClick",
        operation: "firebaseAuth.signInWithPopup",
        category: "Authentication",
      },
      async () => {
        await setPersistence(auth, browserLocalPersistence);
        return signInWithPopup(auth, provider);
      },
      { expectedErrorCodes: ["auth/popup-closed-by-user"] },
    );
  } catch (error) {
    if (error?.code === "auth/popup-closed-by-user") {
      showGate("Google sign-in was cancelled.");
      return;
    }

    showGate("Google sign-in failed. Check the authorized domain and try again.", true);
  }
});

signOutButton.addEventListener("click", async () => {
  signOutButton.disabled = true;
  try {
    await trackedSignOut("signOutButton.onClick");
  } catch {
    // Failure already logged by trackOperation; the button is restored below.
  } finally {
    signOutButton.disabled = false;
  }
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    showGate();
    return;
  }

  let hasAccess;
  try {
    hasAccess = await hasDocuAlignAccess(user);
  } catch {
    try {
      await trackedSignOut("onAuthStateChanged.recovery");
    } catch {
      // Both failures are already correlated and logged by trackOperation.
    }
    showGate("Access could not be verified. Check your connection and try again.", true);
    return;
  }

  if (!hasAccess) {
    try {
      await trackedSignOut("onAuthStateChanged.denied");
    } catch {
      // Failure already logged; access remains denied and the gate is shown.
    }
    showGate("This Google account does not have CubeSync access.", true);
    return;
  }

  showApp(user);
});
