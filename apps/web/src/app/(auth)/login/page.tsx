import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LoginForm } from "@/components/auth/login-form";
import type { LoginReason } from "@/components/auth/login-form";
import { messages } from "@/lib/messages";
import { sanitizeReturnTo } from "@/lib/return-to";
import { getVendorMe } from "@/lib/vendor-api";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: messages.auth.loginTitle,
};

type LoginPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function readReason(value: string | null): LoginReason {
  return value === "inactive" || value === "session_expired" ? value : null;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const returnTo = sanitizeReturnTo(firstValue(params.returnTo));
  const requestedReason = readReason(firstValue(params.reason));

  const result = await getVendorMe();

  if (result.kind === "ok") {
    if (result.me.mfaEnrollmentRequired) {
      redirect(`/setup-mfa?returnTo=${encodeURIComponent(returnTo)}`);
    }

    redirect(returnTo);
  }

  const reason: LoginReason = result.kind === "inactive" ? "inactive" : requestedReason;

  return <LoginForm returnTo={returnTo} reason={reason} outage={result.kind === "error"} />;
}
