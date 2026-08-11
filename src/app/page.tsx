import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getUserGroups, getGroupDetails } from "@/lib/actions/groups";
import { getMessages } from "@/lib/actions/messages";
import { Dashboard } from "@/components/dashboard";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string }>;
}) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const { group } = await searchParams;
  const groups = await getUserGroups();

  // Determine active group
  let activeGroupId = group || groups[0]?.id || null;
  if (group && !groups.some((g) => g.id === group)) {
    activeGroupId = groups[0]?.id || null;
  }

  const activeGroup = activeGroupId
    ? await getGroupDetails(activeGroupId)
    : null;
  const messages = activeGroupId ? await getMessages(activeGroupId) : [];

  return (
    <Dashboard
      key={activeGroupId ?? "none"}
      username={session.username}
      userId={session.userId}
      groups={groups}
      activeGroup={activeGroup}
      messages={messages}
    />
  );
}