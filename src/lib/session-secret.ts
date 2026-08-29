/**
 * Shared session-signing secret, safe to import from both the Node.js runtime
 * (server actions) and the Edge runtime (proxy). Kept free of `next/headers`
 * and other runtime-specific APIs.
 */
export function getEncodedSessionKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "SESSION_SECRET environment variable is required."
    );
  }
  return new TextEncoder().encode(secret);
}