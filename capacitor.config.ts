import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.chismisa.app",
  appName: "Chismisa",
  server: {
    url: "https://chismisan.vercel.app",
    cleartext: false,
  },
  webDir: "public",
  android: {
    backgroundColor: "#0a0612",
  },
};

export default config;