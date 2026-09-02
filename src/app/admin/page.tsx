import { redirect } from "next/navigation";
import { isAdminCookieValid } from "@/lib/admin-auth";
import { isAnalyticsCookieValid } from "@/lib/analytics-auth";
import { MasterLogin } from "@/components/master-login";

export const metadata = {
  title: "Chismisa Admin",
};

/**
 * Unified admin gateway — the single login surface for both panels.
 * If the visitor already holds a valid cookie for either panel, they are
 * routed straight to the corresponding page without being asked again.
 */
export default async function AdminGatewayPage() {
  const [isAdmin, isAnalytics] = await Promise.all([
    isAdminCookieValid(),
    isAnalyticsCookieValid(),
  ]);

  if (isAdmin) redirect("/chismis-admin");
  if (isAnalytics) redirect("/chismis-analytics");

  return <MasterLogin />;
}