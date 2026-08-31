import { isAdminCookieValid } from "@/lib/admin-auth";
import { AdminPanel } from "@/components/admin-panel";
import { AdminLogin } from "@/components/admin-login";

export const metadata = {
  title: "Chismisa Admin",
};

export default async function AdminPage() {
  const isAuthorized = await isAdminCookieValid();

  if (!isAuthorized) {
    return <AdminLogin />;
  }

  return <AdminPanel />;
}
