import { PageHeader } from "@partner-coder/ui";
import type { Metadata } from "next";

import { ConsoleGuard } from "@/components/console/console-guard";
import { ProfileCard } from "@/components/console/profile-card";
import { SessionCard } from "@/components/console/session-card";
import { messages } from "@/lib/messages";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: messages.profile.title,
  robots: { index: false },
};

type MePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

export default async function MePage({ searchParams }: MePageProps) {
  const params = await searchParams;
  const enrolled = firstValue(params.enrolled) === "1";

  return (
    <ConsoleGuard returnTo="/me">
      {(me) => (
        <div className="grid gap-6">
          <PageHeader title={messages.profile.title} description={messages.profile.description} />
          <ProfileCard me={me} enrolled={enrolled} />
          <SessionCard sessionExpiresAt={me.sessionExpiresAt} stepUpUntil={me.stepUpUntil} />
        </div>
      )}
    </ConsoleGuard>
  );
}
