"use client";

import { Capacitor } from "@capacitor/core";
import {
  PushNotifications,
  type PushNotificationToken,
  type PushNotificationSchema,
  type PushNotificationActionPerformed,
  type RegistrationError,
} from "@capacitor/push-notifications";
import { initializeApp, getApps } from "firebase/app";
import {
  getMessaging,
  getToken,
  onMessage,
  isSupported as fcmIsSupported,
} from "firebase/messaging";

export type PushRegisterResult = {
  granted: boolean;
  token?: string;
  error?: string;
};

let _listenersInstalled = false;

// Firebase web config — public values, safe to expose client-side.
const firebaseConfig = {
  apiKey: "AIzaSyBxSIDjdwGirCjH8kvhpIUEwkQmRg8Hj3Y",
  authDomain: "chismisa-fd9b8.firebaseapp.com",
  projectId: "chismisa-fd9b8",
  storageBucket: "chismisa-fd9b8.firebasestorage.app",
  messagingSenderId: "125114823607",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:125114823607:web:f912492a40e761b01aae32",
};

// VAPID public key — generated in Firebase Console → Cloud Messaging →
// Web Push certificates. Set NEXT_PUBLIC_FIREBASE_VAPID_KEY env var.
const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY || "";

/**
 * Request notification permission + register for push.
 * - Native (Capacitor): uses @capacitor/push-notifications (FCM via Android)
 * - Web / PWA: uses Firebase JS SDK with a service worker
 */
export async function registerPush(): Promise<PushRegisterResult> {
  if (Capacitor.isNativePlatform()) {
    return registerNativePush();
  }
  return registerWebPush();
}

async function registerNativePush(): Promise<PushRegisterResult> {
  // 1) Ask the user for notification permission
  const perm = await PushNotifications.requestPermissions();
  if (perm.receive !== "granted") {
    return { granted: false, error: "Notification permission denied." };
  }

  // 2) Trigger registration with FCM — the "registration" listener below
  //    fires once the token is ready.
  await PushNotifications.register();

  return { granted: true };
}

async function registerWebPush(): Promise<PushRegisterResult> {
  if (!vapidKey) {
    return {
      granted: false,
      error:
        "Web push not configured. Set NEXT_PUBLIC_FIREBASE_VAPID_KEY env var.",
    };
  }

  if (!(await fcmIsSupported())) {
    return { granted: false, error: "Push notifications not supported." };
  }

  // Check browser permission
  if (typeof Notification === "undefined") {
    return { granted: false, error: "Notifications not supported." };
  }

  let permission = Notification.permission;
  if (permission !== "granted") {
    permission = await Notification.requestPermission();
  }
  if (permission !== "granted") {
    return { granted: false, error: "Notification permission denied." };
  }

  try {
    // Initialize Firebase (idempotent)
    const app = getApps()[0] ?? initializeApp(firebaseConfig);
    const messaging = getMessaging(app);

    // Register the messaging service worker and get an FCM web token
    const token = await getToken(messaging, {
      vapidKey,
      serviceWorkerRegistration: await navigator.serviceWorker.register(
        "/firebase-messaging-sw.js"
      ),
    });

    if (!token) {
      return { granted: false, error: "Failed to get push token." };
    }

    // Save the web token on our server (platform: "web")
    await registerDeviceToken(token, "web");

    return { granted: true, token };
  } catch (err) {
    console.error("Web push registration error:", err);
    return {
      granted: false,
      error: err instanceof Error ? err.message : "Push registration failed.",
    };
  }
}

/**
 * Install Capacitor push listeners (native only).
 * Call once, on the native shell (e.g. from <NativeInit />).
 */
export function addPushListeners(
  onNotificationReceived?: (notif: PushNotificationSchema) => void
) {
  if (!Capacitor.isNativePlatform()) return;
  if (_listenersInstalled) return;
  _listenersInstalled = true;

  PushNotifications.addListener(
    "registration",
    (token: PushNotificationToken) => {
      registerDeviceToken(token.value, "android");
    }
  );

  PushNotifications.addListener(
    "registrationError",
    (error: RegistrationError) => {
      console.error("Push registration error:", error);
    }
  );

  PushNotifications.addListener(
    "pushNotificationReceived",
    (notification: PushNotificationSchema) => {
      onNotificationReceived?.(notification);
      console.log("Push received:", {
        title: notification.title ?? "New message",
        body: notification.body ?? "",
      });
    }
  );

  PushNotifications.addListener(
    "pushNotificationActionPerformed",
    (action: PushNotificationActionPerformed) => {
      // When the user taps a notification, jump to the relevant group
      const groupId = action.notification?.data?.groupId as string | undefined;
      if (groupId) {
        // Full-page navigation - the Capacitor push listener has no
        // router context. Build an absolute URL (satisfies the lint rule).
        window.location.href = new URL(
          `/?group=${groupId}`,
          window.location.origin
        ).href;
      } else {
        window.location.href = new URL("/", window.location.origin).href;
      }
    }
  );
}

/**
 * Install foreground message listener for web/PWA.
 * Background messages are handled by firebase-messaging-sw.js automatically.
 */
export function addWebMessageListener(
  callback?: (payload: { title?: string; body?: string }) => void
) {
  if (Capacitor.isNativePlatform()) return;
  if (!vapidKey || getApps().length === 0) return;

  try {
    const messaging = getMessaging(getApps()[0]);
    onMessage(messaging, (payload) => {
      callback?.({
        title: payload.notification?.title,
        body: payload.notification?.body,
      });
    });
  } catch (err) {
    console.error("Foreground message listener error:", err);
  }
}

/**
 * Send the device token to our server so it can be targeted by FCM.
 * Requires an active session (the /api/devices route is auth-gated).
 */
export async function registerDeviceToken(token: string, platform = "android") {
  try {
    await fetch("/api/devices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ action: "register", token, platform }),
    });
  } catch (err) {
    console.error("Failed to register device token on server:", err);
  }
}

/**
 * Tell the server to forget a device token (e.g. on logout).
 */
export async function unregisterDeviceToken(token: string) {
  try {
    await fetch("/api/devices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ action: "unregister", token }),
    });
  } catch (err) {
    console.error("Failed to unregister device token on server:", err);
  }
}