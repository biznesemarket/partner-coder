import type { ReactNode } from "react";

import { ConsoleShell } from "@/components/console/console-shell";
import { StepUpProvider } from "@/components/console/step-up-provider";
import { getVendorMe } from "@/lib/vendor-api";

export const dynamic = "force-dynamic";

type ConsoleLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default async function ConsoleLayout({ children }: ConsoleLayoutProps) {
  const result = await getVendorMe();

  if (result.kind === "ok" && !result.me.mfaEnrollmentRequired) {
    return (
      <StepUpProvider>
        <ConsoleShell me={result.me}>{children}</ConsoleShell>
      </StepUpProvider>
    );
  }

  return <>{children}</>;
}
