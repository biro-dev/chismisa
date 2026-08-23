import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { triggerGroupEvent } from "@/lib/pusher";

// Broadcast a "user is typing" event to everyone else in the group.
// Rate-limited by the client (debounced) — server does a basic member check.
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const groupId: string = body.groupId;

    if (!groupId) {
      return NextResponse.json({ error: "Missing groupId" }, { status: 400 });
    }

    // Verify the user is a member of this group
    const isMember = await db.groupMember.findUnique({
      where: {
        userId_groupId: {
          userId: session.userId,
          groupId,
        },
      },
      select: { id: true },
    });

    if (!isMember) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Fire the typing event (non-blocking — pusher.ts logs errors silently)
    triggerGroupEvent(groupId, "user-typing", {
      userId: session.userId,
      username: session.username,
      timestamp: Date.now(),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Typing broadcast error:", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
