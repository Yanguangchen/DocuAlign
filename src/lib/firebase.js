/**
 * @file firebase.js
 * @description Core Firebase SDK initialization for DocuAlign.
 * Configures the shared crewhub-43647 Firebase app instance and exports singletons
 * for Cloud Firestore (`db`), Firebase Authentication (`auth`), Cloud Storage (`storage`),
 * and conditional Analytics (`getAppAnalytics`). Safe for Vite HMR and Vitest environments.
 */
import { initializeApp, getApps, getApp } from "firebase/app";
import * as analytics from "firebase/analytics";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getStorage } from "firebase/storage";
import { logWarn } from "./logger.js";

export const firebaseConfig = {
  apiKey: "AIzaSyDovmjClkov6q1qRQkkgCExH31rEbX0X2M",
  authDomain: "crewhub-43647.firebaseapp.com",
  projectId: "crewhub-43647",
  storageBucket: "crewhub-43647.firebasestorage.app",
  messagingSenderId: "847443127747",
  appId: "1:847443127747:web:8015626f31bf99b713a176",
  measurementId: "G-Z7BVFKESL4"
};

// Initialize Firebase app safely (prevents duplicate app errors in HMR/testing)
export const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Initialize core Firebase SDK services
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);

// Initialize analytics conditionally when supported by the environment
let analyticsPromise = null;

export const resetAnalyticsPromise = () => {
  analyticsPromise = null;
};

export const getAppAnalytics = () => {
  if (!analyticsPromise) {
    analyticsPromise = analytics.isSupported().then((supported) => {
      if (supported) {
        return analytics.getAnalytics(app);
      }
      return null;
    }).catch((error) => {
      logWarn("Firebase Analytics unavailable", {
        feature: "Firebase",
        function: "getAppAnalytics",
        operation: "analytics.isSupported",
        category: "AnalyticsInitializationFailure",
        errorMessage: String(error),
      });
      return null;
    });
  }
  return analyticsPromise;
};
