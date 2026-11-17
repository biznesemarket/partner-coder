import { redirect } from "next/navigation";
import type { ReactNode } from "react";

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

  switch (result.kind) {
    case "unauthenticated":
      return redirect(`/login?returnTo=${encodeURIComponent(safeReturnTo)}`);
    case "inactive":
      return redirect("/login?reason=inactive");
    case "error":
      return <ServiceUnavailable />;
    case "ok":
      if (result.me.mfaEnrollmentRequired) {
        return redirect(`/setup-mfa?returnTo=${encodeURIComponent(safeReturnTo)}`);
      }

      return <>{children(result.me)}</>;
  }
}
