import type { Metadata } from "next";

import { SetupMfaForm } from "@/components/auth/setup-mfa-form";
import { MfaSetupGuard } from "@/components/console/mfa-setup-guard";
import { messages } from "@/lib/messages";
import { sanitizeReturnTo } from "@/lib/return-to";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: messages.auth.setupMfaTitle,
  robots: { index: false },
};

type SetupMfaPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

export default async function SetupMfaPage({ searchParams }: SetupMfaPageProps) {
  const params = await searchParams;
  const returnTo = sanitizeReturnTo(firstValue(params.returnTo));

  return (
    <MfaSetupGuard returnTo={returnTo}>{() => <SetupMfaForm returnTo={returnTo} />}</MfaSetupGuard>
  );
}
