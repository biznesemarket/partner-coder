import type { ReactNode } from "react";

import { ConsoleShell } from "@/components/console/console-shell";
import { getVendorMe } from "@/lib/vendor-api";

export const dynamic = "force-dynamic";

type ConsoleLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default async function ConsoleLayout({ children }: ConsoleLayoutProps) {
  const result = await getVendorMe();

  if (result.kind === "ok" && !result.me.mfaEnrollmentRequired) {
    return <ConsoleShell me={result.me}>{children}</ConsoleShell>;
  }

  return <>{children}</>;
}
