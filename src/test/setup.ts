// Shared test setup. Environment-specific setup (jsdom cleanup, etc.) can be
// added here; it applies to every test file run by Vitest.

import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});