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
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { messages } from "@/lib/messages";
import { PASSWORD_MIN_LENGTH, passwordError, passwordsMatchError } from "@/lib/password";

import { handleConsoleAuthError } from "./auth-error";

const CURRENT_ID = "security-current-password";

const NEW_ID = "security-new-password";

const CONFIRM_ID = "security-confirm-password";

type FieldErrors = {
  current?: string;
  next?: string;
  confirm?: string;
};

export function ChangePasswordForm() {
  const router = useRouter();
  const pathname = usePathname();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function clearFieldError(field: keyof FieldErrors): void {
    setFieldErrors((current) => {
      if (!(field in current)) {
        return current;
      }

      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (pending) {
      return;
    }

    const errors: FieldErrors = {};
    const currentError = currentPassword === "" ? messages.security.currentPasswordRequired : null;
    const newError = passwordError(newPassword, PASSWORD_MIN_LENGTH);
    const confirmError =
      confirmPassword === ""
        ? messages.auth.confirmPasswordRequired
        : passwordsMatchError(newPassword, confirmPassword);

    if (currentError !== null) {
      errors.current = currentError;
    }

    if (newError !== null) {
      errors.next = newError;
    }

    if (confirmError !== null) {
      errors.confirm = confirmError;
    }

    setFieldErrors(errors);
    setFormError(null);

    if (errors.current !== undefined || errors.next !== undefined || errors.confirm !== undefined) {
      return;
    }

    setPending(true);

    try {
      const { error } = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });

      if (error) {
        const message = handleConsoleAuthError(error, router, pathname);
        if (message === null) {
          return;
        }

        if (error.code === "INVALID_PASSWORD" || error.code === "INVALID_CREDENTIALS") {
          setFieldErrors({ current: message });
        } else {
          setFormError(message);
        }

        return;
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setFieldErrors({});
      toast.success(messages.security.passwordSuccess);
    } catch {
      setFormError(messages.errors.generic);
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{messages.security.passwordTitle}</CardTitle>
        <CardDescription>{messages.security.passwordDescription}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={(event) => void handleSubmit(event)} noValidate>
          <Field
            label={messages.security.currentPasswordLabel}
            htmlFor={CURRENT_ID}
            {...(fieldErrors.current ? { error: fieldErrors.current } : {})}
          >
            <PasswordInput
              id={CURRENT_ID}
              name="currentPassword"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => {
                setCurrentPassword(event.target.value);
                clearFieldError("current");
                setFormError(null);
              }}
              aria-describedby={fieldErrors.current ? `${CURRENT_ID}-error` : undefined}
              aria-invalid={fieldErrors.current ? true : undefined}
              disabled={pending}
            />
          </Field>
          <Field
            label={messages.auth.newPasswordLabel}
            htmlFor={NEW_ID}
            hint={messages.auth.passwordHint(PASSWORD_MIN_LENGTH)}
            {...(fieldErrors.next ? { error: fieldErrors.next } : {})}
          >
            <PasswordInput
              id={NEW_ID}
              name="newPassword"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => {
                setNewPassword(event.target.value);
                clearFieldError("next");
                setFormError(null);
              }}
              aria-describedby={fieldErrors.next ? `${NEW_ID}-error` : `${NEW_ID}-hint`}
              aria-invalid={fieldErrors.next ? true : undefined}
              disabled={pending}
            />
          </Field>
          <Field
            label={messages.auth.confirmPasswordLabel}
            htmlFor={CONFIRM_ID}
            {...(fieldErrors.confirm ? { error: fieldErrors.confirm } : {})}
          >
            <PasswordInput
              id={CONFIRM_ID}
              name="confirmPassword"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => {
                setConfirmPassword(event.target.value);
                clearFieldError("confirm");
                setFormError(null);
              }}
              aria-describedby={fieldErrors.confirm ? `${CONFIRM_ID}-error` : undefined}
              aria-invalid={fieldErrors.confirm ? true : undefined}
              disabled={pending}
            />
          </Field>
          <div aria-live="polite" className="min-h-0 text-sm text-destructive">
            {formError}
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner className="h-4 w-4" /> : null}
            {pending ? messages.security.passwordPending : messages.security.passwordSubmit}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
