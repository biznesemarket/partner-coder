import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { sanitizeReturnTo } from "@/lib/return-to";
import { getVendorMe } from "@/lib/vendor-api";
import type { VendorMe } from "@/lib/vendor-types";

import { ServiceUnavailable } from "./service-unavailable";

type MfaSetupGuardProps = {
  returnTo: string;
  children: (me: VendorMe) => ReactNode;
};

export async function MfaSetupGuard({ returnTo, children }: MfaSetupGuardProps) {
  const result = await getVendorMe();
  const safeReturnTo = sanitizeReturnTo(returnTo);

  if (result.kind === "unauthenticated") {
    redirect(`/login?returnTo=${encodeURIComponent(safeReturnTo)}`);
  }

  if (result.kind === "inactive") {
    redirect("/login?reason=inactive");
  }

  if (result.kind === "error") {
    return <ServiceUnavailable />;
  }

  if (!result.me.mfaEnrollmentRequired) {
    redirect("/me");
  }

  return <>{children(result.me)}</>;
}
