import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";

export default async function JoinPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const session = await getSession();
  if (!session) {
    // Not logged in — redirect to login with a return path
    redirect("/login");
  }

  const { code: rawCode } = await params;
  const code = decodeURIComponent(rawCode).trim().toUpperCase();

  // Find the group by invite code
  const group = await db.group.findUnique({ where: { code } });

  if (!group) {
    redirect("/?error=invalid-code");
  }

  // Check if already a member
  const existingMember = await db.groupMember.findUnique({
    where: {
      userId_groupId: { userId: session.userId, groupId: group.id },
    },
  });

  if (!existingMember) {
    await db.groupMember.create({
      data: { userId: session.userId, groupId: group.id },
    });
  }

  // Redirect to the group chat
  redirect(`/?group=${group.id}`);
}