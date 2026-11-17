import { redirect } from "next/navigation";

import { ServiceUnavailable } from "@/components/console/service-unavailable";
import { guardAction } from "@/lib/guard";
import { getVendorMe } from "@/lib/vendor-api";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const result = await getVendorMe();
  const action = guardAction(result);

  if (action === "render") {
    redirect("/me");
  }

  if (action === "mfa") {
    redirect("/setup-mfa");
  }

  if (action === "login") {
    redirect("/login");
  }

  if (action === "inactive") {
    redirect("/login?reason=inactive");
  }

  return <ServiceUnavailable />;
}
