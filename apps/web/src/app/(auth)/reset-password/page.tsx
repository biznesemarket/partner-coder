import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@partner-coder/ui";
import type { Metadata } from "next";
import Link from "next/link";

import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { messages } from "@/lib/messages";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: messages.auth.resetTitle,
  robots: { index: false },
};

type ResetPasswordPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function MissingLinkState({ invalid }: { invalid: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {invalid ? messages.auth.resetInvalidTitle : messages.auth.resetIncompleteTitle}
        </CardTitle>
        {invalid ? null : (
          <CardDescription>{messages.auth.resetIncompleteDescription}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="grid gap-4">
        {invalid ? (
          <Alert className="border-destructive/40 bg-destructive/5 text-destructive">
            {messages.auth.resetInvalidDescription}
          </Alert>
        ) : null}
        <Button asChild>
          <Link href="/login">{messages.auth.resetRequestNew}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const params = await searchParams;
  const token = firstValue(params.token);

  if (token === null || token === "") {
    return <MissingLinkState invalid={firstValue(params.error) === "INVALID_TOKEN"} />;
  }

  return <ResetPasswordForm token={token} />;
}
