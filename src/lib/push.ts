("use client" as const);

import { Capacitor } from "@capacitor/core";
import {
  PushNotifications,
  type PushNotificationToken,
  type PushNotificationSchema,
  type PushNotificationActionPerformed,
  type RegistrationError,
} from "@capacitor/push-notifications";

export type PushRegisterResult = {
  granted: boolean;
  token?: string;
  error?: string;
};

let _listenersInstalled = false;

/**
 * Request notification permission + register for push on native.
 * Safe to call anywhere — no-op on web.
 */
export async function registerPush(): Promise<PushRegisterResult> {
  if (!Capacitor.isNativePlatform()) {
    return { granted: false, error: "Not a native platform." };
  }

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

/**
 * Install Capacitor push listeners.
 * Call once, on the native shell (e.g. from <NativeInit />).
 *
 * Each listener:
 *  - "registration": stores the new/rotated token on the server
 *  - "pushNotificationReceived": optional handler (e.g. show a local banner)
 *  - "pushNotificationActionPerformed": open the relevant group on tap
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

      // Show an in-app toast/banner so the user sees it even in the foreground
      const title = notification.title ?? "New message";
      const body = notification.body ?? "";
      // The Capacitor notification shows automatically when received in the
      // foreground if we don't have a custom notification service; keep a
      // console trace as a fallback.
      console.log("Push received:", { title, body });
    }
  );

  PushNotifications.addListener(
    "pushNotificationActionPerformed",
    (action: PushNotificationActionPerformed) => {
      // When the user taps a notification, jump to the relevant group
      const groupId = action.notification?.data?.groupId as string | undefined;
      if (groupId) {
        window.location.href = `/?group=${groupId}`;
      } else {
        window.location.href = "/";
      }
    }
  );
}

/**
 * Send the device token to our server so it can be targeted by FCM.
 * Requires an active session (the /api/devices route is auth-gated).
 */
export async function registerDeviceToken(
  token: string,
  platform = "android"
) {
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
