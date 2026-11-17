"use client";

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CodeInput,
  Field,
  Input,
  Spinner,
  normalizeBackupCode,
  normalizeOtp,
} from "@partner-coder/ui";
import { useState } from "react";
import type { FormEvent } from "react";

import { authClient } from "@/lib/auth-client";
import { mapAuthError } from "@/lib/errors";
import { messages } from "@/lib/messages";

const CODE_ID = "login-code";

const BACKUP_CODE_ID = "login-backup-code";

const CODE_LENGTH = 6;

type TwoFactorFormProps = {
  useBackupCode: boolean;
  onToggleBackupCode: () => void;
  onBack: () => void;
  onVerified: () => void;
};

export function TwoFactorForm({
  useBackupCode,
  onToggleBackupCode,
  onBack,
  onVerified,
}: TwoFactorFormProps) {
  const [code, setCode] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function changeCode(next: string): void {
    setCode(next);
    setFieldError(null);
    setFormError(null);
  }

  function toggleBackupCode(): void {
    setCode("");
    setFieldError(null);
    setFormError(null);
    onToggleBackupCode();
  }

  async function verifyCode(value: string): Promise<void> {
    setPending(true);

    try {
      const response = useBackupCode
        ? await authClient.twoFactor.verifyBackupCode({ code: value })
        : await authClient.twoFactor.verifyTotp({ code: value });

      if (response.error) {
        setFormError(mapAuthError(response.error));
        return;
      }

      onVerified();
    } catch {
      setFormError(messages.errors.generic);
    } finally {
      setPending(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (pending) {
      return;
    }

    if (useBackupCode) {
      const normalized = normalizeBackupCode(code);

      if (normalized === "") {
        setFieldError(messages.auth.backupCodeRequired);
        return;
      }

      await verifyCode(normalized);
      return;
    }

    const normalized = normalizeOtp(code);

    if (normalized.length !== CODE_LENGTH) {
      setFieldError(messages.auth.codeRequired);
      return;
    }

    await verifyCode(normalized);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{messages.auth.twoFactorTitle}</CardTitle>
        <CardDescription>{messages.auth.twoFactorDescription}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={(event) => void handleSubmit(event)} noValidate>
          {useBackupCode ? (
            <Field
              label={messages.auth.backupCodeLabel}
              htmlFor={BACKUP_CODE_ID}
              hint={messages.auth.backupCodeHint}
              {...(fieldError ? { error: fieldError } : {})}
            >
              <Input
                id={BACKUP_CODE_ID}
                name="backup-code"
                autoComplete="one-time-code"
                autoFocus
                value={code}
                onChange={(event) => changeCode(event.target.value)}
                aria-describedby={fieldError ? `${BACKUP_CODE_ID}-error` : `${BACKUP_CODE_ID}-hint`}
                aria-invalid={fieldError ? true : undefined}
                disabled={pending}
              />
            </Field>
          ) : (
            <Field
              label={messages.auth.codeLabel}
              htmlFor={CODE_ID}
              hint={messages.auth.codeHint}
              {...(fieldError ? { error: fieldError } : {})}
            >
              <CodeInput
                id={CODE_ID}
                name="code"
                value={code}
                onChange={changeCode}
                autoFocus
                disabled={pending}
                aria-describedby={fieldError ? `${CODE_ID}-error` : `${CODE_ID}-hint`}
                {...(fieldError ? { "aria-invalid": true } : {})}
              />
            </Field>
          )}
          <div aria-live="polite" className="min-h-0 text-sm text-destructive">
            {formError}
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner className="h-4 w-4" /> : null}
            {pending ? messages.auth.twoFactorPending : messages.auth.twoFactorSubmit}
          </Button>
          <div className="flex flex-col items-start gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={toggleBackupCode}
              disabled={pending}
            >
              {useBackupCode ? messages.auth.useTotpCode : messages.auth.backupCode}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onBack} disabled={pending}>
              {messages.auth.backToPassword}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
