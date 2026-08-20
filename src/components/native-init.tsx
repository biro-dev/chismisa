"use client";

import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";
import { SplashScreen } from "@capacitor/splash-screen";

export function NativeInit() {
  useEffect(() => {
    // Only run on native (Capacitor) platforms — no-op on web
    if (!Capacitor.isNativePlatform()) return;

    // Set status bar to match the app's dark theme
    StatusBar.setStyle({ style: Style.Light });
    StatusBar.setBackgroundColor({ color: "#0a0612" });

    // Hide splash screen once the app is ready
    SplashScreen.hide({ fadeOutDuration: 300 });
  }, []);

  return null;
}