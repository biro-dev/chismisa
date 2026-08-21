import "server-only";
import { initializeApp, cert, getApps, type App } from "firebase-admin/app";
import { getMessaging as getAdminMessaging } from "firebase-admin/messaging";

// Initialize Firebase Admin SDK (server-side only) using the service account JSON
// passed via the FIREBASE_SERVICE_ACCOUNT env var. We support two modes:
//  1. A filesystem path (e.g. "./chismisa-fd9b8-firebase-adminsdk-fbsvc-25be00d301.json")
//  2. A raw JSON string (set directly in env vars / .env)

let firebaseApp: App | undefined;

export function getFirebaseAdmin(): App {
  if (firebaseApp) return firebaseApp;

  const existing = getApps()[0];
  if (existing) {
    firebaseApp = existing;
    return existing;
  }

  const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
  if (!serviceAccountRaw) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT env var is not set. Add the Firebase service " +
        "account JSON (or path to it) to .env / Vercel environment variables."
    );
  }

  let credential: Record<string, string>;
  // If the value looks like a path that exists, read it from disk.
  if (serviceAccountRaw.startsWith("/") || serviceAccountRaw.startsWith("./")) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs");
    credential = JSON.parse(fs.readFileSync(serviceAccountRaw, "utf8"));
  } else {
    credential = JSON.parse(serviceAccountRaw);
  }

  firebaseApp = initializeApp({
    credential: cert(credential),
  });

  return firebaseApp;
}

export function getMessaging() {
  const app = getFirebaseAdmin();
  return getAdminMessaging(app);
}