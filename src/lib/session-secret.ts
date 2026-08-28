/**
 * Shared session-signing secret, safe to import from both the Node.js runtime
 * (server actions) and the Edge runtime (proxy). Kept free of `next/headers`
 * and other runtime-specific APIs.
 */
export function getEncodedSessionKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "SESSION_SECRET environment variable is required in production."
      );
    }
    // Development-only fallback. Never used in production — see above.
    return new TextEncoder().encode("chismisa-dev-secret");
  }
  return new TextEncoder().encode(secret);
}