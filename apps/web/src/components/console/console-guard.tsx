import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { guardAction } from "@/lib/guard";
import { sanitizeReturnTo } from "@/lib/return-to";
import { getVendorMe } from "@/lib/vendor-api";
import type { VendorMe } from "@/lib/vendor-types";

import { ServiceUnavailable } from "./service-unavailable";

type ConsoleGuardProps = {
  returnTo: string;
  children: (me: VendorMe) => ReactNode;
};

export async function ConsoleGuard({ returnTo, children }: ConsoleGuardProps) {
  const result = await getVendorMe();
  const safeReturnTo = sanitizeReturnTo(returnTo);
  const action = guardAction(result);

  if (action === "login") {
    redirect(`/login?returnTo=${encodeURIComponent(safeReturnTo)}`);
  }

  if (action === "inactive") {
    redirect("/login?reason=inactive");
  }

  if (action === "mfa") {
    redirect(`/setup-mfa?returnTo=${encodeURIComponent(safeReturnTo)}`);
  }

  if (action === "error" || result.kind !== "ok") {
    return <ServiceUnavailable />;
  }

  return <>{children(result.me)}</>;
}
