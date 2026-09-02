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

      // Keyboard-aware height for older WebViews: interactiveWidget =
      // resizes-content (viewport meta) covers WebView 108+, but older
      // versions keep the layout viewport at full height when the keyboard
      // opens, hiding the composer. Track the visual viewport and expose the
      // visible height as --app-h so the app shell can shrink to it.
      const visualViewport = window.visualViewport;
      if (visualViewport) {
        const root = document.documentElement;
        const updateAppHeight = () => {
          const keyboardOpen = window.innerHeight - visualViewport.height > 150;
          if (keyboardOpen) {
            root.style.setProperty("--app-h", `${visualViewport.height}px`);
          } else {
            root.style.removeProperty("--app-h");
          }
        };
        visualViewport.addEventListener("resize", updateAppHeight);
        visualViewport.addEventListener("scroll", updateAppHeight);
        updateAppHeight();
      }

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