"use client";

import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";
import { SplashScreen } from "@capacitor/splash-screen";
import { registerPush, addPushListeners, addWebMessageListener } from "@/lib/push";

export function NativeInit() {
  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      // --- Native (Android APK) ---

      // Tag the document so CSS can treat the native app differently from
      // desktop browsers (e.g. never re-enable text selection on bubbles —
      // it breaks the long-press reaction gesture).
      document.documentElement.classList.add("native-app");

      // Status bar: prevent overlap on notched phones
      StatusBar.setOverlaysWebView({ overlay: false });
      StatusBar.setStyle({ style: Style.Light });
      StatusBar.setBackgroundColor({ color: "#0a0612" });

      // Register for push notifications via Capacitor plugin
      registerPush()
        .then((result) => {
          if (result.granted) addPushListeners();
        })
        .catch((err) => console.error("Push setup error:", err));

      // Hide the splash screen once the app shell is ready
      SplashScreen.hide({ fadeOutDuration: 300 });
    } else {
      // --- Web / PWA ---

      // Register the app shell service worker (PWA install + offline)
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("/sw.js").catch((err) => {
          console.error("Service worker registration error:", err);
        });
      }

      // Register for web push notifications (FCM web token)
      registerPush()
        .then((result) => {
          if (result.granted) addWebMessageListener();
        })
        .catch((err) => console.error("Web push setup error:", err));
    }
  }, []);

  return null;
}