"use client";

import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";
import { SplashScreen } from "@capacitor/splash-screen";
import { registerPush, addPushListeners } from "@/lib/push";

export function NativeInit() {
  useEffect(() => {
    // Only run on native (Capacitor) platforms — no-op on the web
    if (!Capacitor.isNativePlatform()) return;

    // --- Status bar: prevent overlap on notched phones ---
    // Tell Android NOT to draw the web content under the status bar so the
    // clock / battery / notifications don't overlap our header.
    StatusBar.setOverlaysWebView({ overlay: false });

    // Dark app background -> light (white) status-bar icons for readability
    StatusBar.setStyle({ style: Style.Light });
    StatusBar.setBackgroundColor({ color: "#0a0612" });

    // --- Push notifications ---
    // Request permission and register for an FCM token. The "registration"
    // listener inside addPushListeners() saves the token to our server.
    registerPush()
      .then((result) => {
        if (result.granted) addPushListeners();
      })
      .catch((err) => console.error("Push setup error:", err));

    // Hide the splash screen once the app shell is ready
    SplashScreen.hide({ fadeOutDuration: 300 });
  }, []);

  return null;
}
