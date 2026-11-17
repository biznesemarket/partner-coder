import { PageHeader } from "@partner-coder/ui";
import type { Metadata } from "next";

import { ChangePasswordForm } from "@/components/console/change-password-form";
import { ConsoleGuard } from "@/components/console/console-guard";
import { RevokeSessionsButton } from "@/components/console/revoke-sessions-button";
import { SecurityCard } from "@/components/console/security-card";
import { messages } from "@/lib/messages";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: messages.security.title,
  robots: { index: false },
};

type SecurityPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

export default async function SecurityPage({ searchParams }: SecurityPageProps) {
  const params = await searchParams;
  const enrolled = firstValue(params.enrolled) === "1";

  return (
    <ConsoleGuard returnTo="/me/security">
      {(me) => (
        <div className="grid gap-6">
          <PageHeader title={messages.security.title} description={messages.security.description} />
          <SecurityCard twoFactorEnabled={me.user.twoFactorEnabled} enrolled={enrolled} />
          <ChangePasswordForm />
          <RevokeSessionsButton />
        </div>
      )}
    </ConsoleGuard>
  );
}
