"use client";

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  PasswordInput,
  Spinner,
} from "@partner-coder/ui";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import { authClient } from "@/lib/auth-client";
import { mapAuthError } from "@/lib/errors";
import type { AuthErrorLike } from "@/lib/errors";
import { messages } from "@/lib/messages";
import { PASSWORD_MIN_LENGTH, passwordError, passwordsMatchError } from "@/lib/password";

const PASSWORD_ID = "reset-password-new";

const CONFIRM_ID = "reset-password-confirm";

type ResetStatus = "form" | "success" | "invalid";

type FieldErrors = {
  password?: string;
  confirmation?: string;
};

type ResetPasswordFormProps = {
  token: string;
};

function isInvalidTokenError(error: AuthErrorLike | null | undefined): boolean {
  return error?.code === "INVALID_TOKEN" || error?.code === "USER_NOT_FOUND";
}

function removeTokenFromAddressBar(): void {
  const url = new URL(window.location.href);

  if (!url.searchParams.has("token")) {
    return;
  }

  url.searchParams.delete("token");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

export function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<ResetStatus>("form");

  useEffect(() => {
    removeTokenFromAddressBar();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (pending) {
      return;
    }

    const nextErrors: FieldErrors = {};
    const nextPasswordError = passwordError(password, PASSWORD_MIN_LENGTH);

    if (nextPasswordError !== null) {
      nextErrors.password = nextPasswordError;
    }

    if (confirmation === "") {
      nextErrors.confirmation = messages.auth.confirmPasswordRequired;
    } else {
      const nextMatchError = passwordsMatchError(password, confirmation);

      if (nextMatchError !== null) {
        nextErrors.confirmation = nextMatchError;
      }
    }

    setFieldErrors(nextErrors);
    setFormError(null);

    if (nextErrors.password !== undefined || nextErrors.confirmation !== undefined) {
      return;
    }

    setPending(true);

    try {
      const { error } = await authClient.resetPassword({ newPassword: password, token });

      if (error) {
        if (isInvalidTokenError(error)) {
          setPassword("");
          setConfirmation("");
          setStatus("invalid");
          return;
        }

        setFormError(mapAuthError(error));
        return;
      }

      setPassword("");
      setConfirmation("");
      setStatus("success");
    } catch {
      setFormError(messages.errors.generic);
    } finally {
      setPending(false);
    }
  }

  if (status === "success") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{messages.auth.resetSuccessTitle}</CardTitle>
          <CardDescription>{messages.auth.resetSuccessDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/login">{messages.auth.resetToLogin}</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (status === "invalid") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{messages.auth.resetInvalidTitle}</CardTitle>
          <CardDescription>{messages.auth.resetInvalidDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/login">{messages.auth.resetRequestNew}</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{messages.auth.resetTitle}</CardTitle>
        <CardDescription>{messages.auth.resetDescription}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={(event) => void handleSubmit(event)} noValidate>
          <Field
            label={messages.auth.newPasswordLabel}
            htmlFor={PASSWORD_ID}
            hint={messages.auth.passwordHint(PASSWORD_MIN_LENGTH)}
            {...(fieldErrors.password ? { error: fieldErrors.password } : {})}
          >
            <PasswordInput
              id={PASSWORD_ID}
              name="newPassword"
              autoComplete="new-password"
              autoFocus
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setFieldErrors((current) => ({ ...current, password: "" }));
              }}
              aria-describedby={
                fieldErrors.password ? `${PASSWORD_ID}-error` : `${PASSWORD_ID}-hint`
              }
              aria-invalid={fieldErrors.password ? true : undefined}
              disabled={pending}
            />
          </Field>
          <Field
            label={messages.auth.confirmPasswordLabel}
            htmlFor={CONFIRM_ID}
            {...(fieldErrors.confirmation ? { error: fieldErrors.confirmation } : {})}
          >
            <PasswordInput
              id={CONFIRM_ID}
              name="confirmPassword"
              autoComplete="new-password"
              value={confirmation}
              onChange={(event) => {
                setConfirmation(event.target.value);
                setFieldErrors((current) => ({ ...current, confirmation: "" }));
              }}
              aria-describedby={fieldErrors.confirmation ? `${CONFIRM_ID}-error` : undefined}
              aria-invalid={fieldErrors.confirmation ? true : undefined}
              disabled={pending}
            />
          </Field>
          <div aria-live="polite" className="min-h-0 text-sm text-destructive">
            {formError}
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner className="h-4 w-4" /> : null}
            {pending ? messages.auth.resetPending : messages.auth.resetSubmit}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
