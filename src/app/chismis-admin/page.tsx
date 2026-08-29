import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AdminPanel } from "@/components/admin-panel";

export const metadata = {
  title: "Chismisa Admin",
};

async function verifyAdminAccess(): Promise<boolean> {
  const cookieStore = await cookies();
  const adminSecret = cookieStore.get("admin_secret")?.value;
  
  if (!adminSecret) {
    return false;
  }

  const masterSecret = process.env.ADMIN_SECRET;
  if (!masterSecret) {
    return false;
  }

  const { timingSafeEqual } = await import("crypto");
  const a = Buffer.from(adminSecret);
  const b = Buffer.from(masterSecret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export default async function AdminPage() {
  const isAuthorized = await verifyAdminAccess();
  
  if (!isAuthorized) {
    redirect("/login");
  }

  return <AdminPanel />;
}