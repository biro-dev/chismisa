import "server-only";
import Pusher from "pusher";

// Server-side Pusher client — triggers real-time events via REST API.
// Works on Vercel serverless (no persistent connections needed).
let pusherServer: Pusher | undefined;

export function getPusherServer(): Pusher | null {
  const appId = process.env.PUSHER_APP_ID;
  const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
  const secret = process.env.PUSHER_SECRET;
  const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;

  if (!appId || !key || !secret || !cluster) {
    return null; // Real-time disabled — app falls back to polling
  }

  if (!pusherServer) {
    pusherServer = new Pusher({
      appId,
      key,
      secret,
      cluster,
      useTLS: true,
    });
  }

  return pusherServer;
}

// Channel name helper — private channels require auth per user
export function groupChannel(groupId: string): string {
  return `private-group-${groupId}`;
}

// Direct-message channel helper (same auth pattern as group channels)
export function dmChannel(conversationId: string): string {
  return `private-dm-${conversationId}`;
}

// Trigger an event on a DM channel (no-op if Pusher isn't configured)
export async function triggerDmEvent(
  conversationId: string,
  event: string,
  data: unknown
): Promise<void> {
  const pusher = getPusherServer();
  if (!pusher) return;

  try {
    await pusher.trigger(dmChannel(conversationId), event, data);
  } catch (err) {
    // Non-critical — polling is the fallback
    console.error(`Pusher DM trigger error (${event}):`, err);
  }
}

// Trigger an event on a group channel (no-op if Pusher isn't configured)
export async function triggerGroupEvent(
  groupId: string,
  event: string,
  data: unknown
): Promise<void> {
  const pusher = getPusherServer();
  if (!pusher) return;

  try {
    await pusher.trigger(groupChannel(groupId), event, data);
  } catch (err) {
    // Non-critical — polling is the fallback
    console.error(`Pusher trigger error (${event}):`, err);
  }
}