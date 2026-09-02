import { redirect } from "next/navigation";
import { isAnalyticsCookieValid } from "@/lib/analytics-auth";
import { AnalyticsPanel } from "@/components/analytics-panel";

export const metadata = {
  title: "Chismisa Analytics",
};

export default async function AnalyticsPage() {
  const isAuthorized = await isAnalyticsCookieValid();

  if (!isAuthorized) {
    // The unified /admin gateway is the single login surface.
    redirect("/admin");
  }

  return <AnalyticsPanel />;
}