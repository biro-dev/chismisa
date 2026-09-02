import { redirect } from "next/navigation";
import { isAdminCookieValid } from "@/lib/admin-auth";
import { AdminPanel } from "@/components/admin-panel";

export const metadata = {
  title: "Chismisa Admin",
};

export default async function AdminPage() {
  const isAuthorized = await isAdminCookieValid();

  if (!isAuthorized) {
    // The unified /admin gateway is the single login surface.
    redirect("/admin");
  }

  return <AdminPanel />;
}
