// Shared test setup. Environment-specific setup (jsdom cleanup, etc.) can be
// added here; it applies to every test file run by Vitest.

import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// Set required environment variables for tests
vi.stubEnv("SESSION_SECRET", "test-secret-key-for-testing-only-32-chars!!");

// Mock Capacitor for components that use it
vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => false,
    isPluginAvailable: () => false,
  },
}));

vi.mock("@capacitor/haptics", () => ({
  Haptics: {
    impact: vi.fn(),
  },
  ImpactStyle: {
    Light: "light",
    Medium: "medium",
    Heavy: "heavy",
  },
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});