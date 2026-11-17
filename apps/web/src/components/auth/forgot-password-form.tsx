"use client";

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Spinner,
} from "@partner-coder/ui";
import { useState } from "react";
import type { FormEvent } from "react";

import { authClient } from "@/lib/auth-client";
import { messages } from "@/lib/messages";

const EMAIL_ID = "forgot-email";

type ForgotPasswordFormProps = {
  onBack: () => void;
};

export function ForgotPasswordForm({ onBack }: ForgotPasswordFormProps) {
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (pending) {
      return;
    }

    const trimmed = email.trim();

    if (trimmed === "") {
      setFieldError(messages.auth.emailRequired);
      return;
    }

    setFieldError(null);
    setPending(true);

    try {
      await authClient
        .requestPasswordReset({
          email: trimmed,
          redirectTo: `${window.location.origin}/reset-password`,
        })
        .catch(() => undefined);
    } finally {
      setPending(false);
      setSent(true);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{messages.auth.forgotPasswordTitle}</CardTitle>
        <CardDescription>{messages.auth.forgotPasswordDescription}</CardDescription>
      </CardHeader>
      <CardContent>
        {sent ? (
          <div className="grid gap-4">
            <p role="status" className="text-sm">
              {messages.auth.forgotPasswordSent}
            </p>
            <Button type="button" variant="outline" onClick={onBack}>
              {messages.auth.forgotPasswordBack}
            </Button>
          </div>
        ) : (
          <form className="grid gap-4" onSubmit={(event) => void handleSubmit(event)} noValidate>
            <Field
              label={messages.auth.emailLabel}
              htmlFor={EMAIL_ID}
              {...(fieldError ? { error: fieldError } : {})}
            >
              <Input
                id={EMAIL_ID}
                name="email"
                type="email"
                autoComplete="email"
                autoFocus
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setFieldError(null);
                }}
                aria-describedby={fieldError ? `${EMAIL_ID}-error` : undefined}
                aria-invalid={fieldError ? true : undefined}
                disabled={pending}
              />
            </Field>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner className="h-4 w-4" /> : null}
              {pending ? messages.auth.forgotPasswordPending : messages.auth.forgotPasswordSubmit}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onBack} disabled={pending}>
              {messages.auth.forgotPasswordBack}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
