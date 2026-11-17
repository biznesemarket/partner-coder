"use client";

import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
  PasswordInput,
  Spinner,
} from "@partner-coder/ui";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import type { FormEvent } from "react";

import { authClient } from "@/lib/auth-client";
import { mapAuthError } from "@/lib/errors";
import { messages } from "@/lib/messages";
import { fetchVendorMe } from "@/lib/vendor-api-client";
import type { VendorMeResult } from "@/lib/vendor-types";

import { afterPassword, afterSecondFactor } from "./login-machine";
import type { TotpStep } from "./login-machine";
import { ForgotPasswordForm } from "./forgot-password-form";
import { isPasskeyCancellation } from "./passkey-error";
import { TwoFactorForm } from "./two-factor-form";

const EMAIL_ID = "login-email";

const PASSWORD_ID = "login-password";

export type LoginReason = "inactive" | "session_expired" | null;

type LoginStep = { kind: "credentials" } | TotpStep;

type LoginFormProps = {
  returnTo: string;
  reason: LoginReason;
  outage: boolean;
};

function subscribeToPasskeySupport(): () => void {
  return () => undefined;
}

function getPasskeySupport(): boolean {
  return typeof window !== "undefined" && "PublicKeyCredential" in window;
}

function getServerPasskeySupport(): boolean {
  return false;
}

function subscribeToHydration(): () => void {
  return () => undefined;
}

function getHydrated(): boolean {
  return true;
}

function getServerHydrated(): boolean {
  return false;
}

export function LoginForm({ returnTo, reason, outage }: LoginFormProps) {
  const router = useRouter();
  const passkeyAvailable = useSyncExternalStore(
    subscribeToPasskeySupport,
    getPasskeySupport,
    getServerPasskeySupport,
  );
  const mounted = useSyncExternalStore(subscribeToHydration, getHydrated, getServerHydrated);
  const [step, setStep] = useState<LoginStep>({ kind: "credentials" });
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState<"password" | "passkey" | null>(null);

  function finishSignIn(result: VendorMeResult): void {
    switch (result.kind) {
      case "ok": {
        const outcome = afterSecondFactor(returnTo, result.me.mfaEnrollmentRequired);

        if (outcome.kind === "enroll") {
          router.replace(`/setup-mfa?returnTo=${encodeURIComponent(outcome.returnTo)}`);
        } else {
          router.replace(outcome.returnTo);
        }

        router.refresh();
        return;
      }
      case "inactive":
        setFormError(messages.errors.inactive);
        return;
      case "unauthenticated":
        setFormError(messages.errors.sessionExpiredRestart);
        return;
      case "error":
        setFormError(messages.errors.serviceUnavailable);
        return;
    }
  }

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (pending !== null) {
      return;
    }

    const nextErrors: { email?: string; password?: string } = {};

    if (email.trim() === "") {
      nextErrors.email = messages.auth.emailRequired;
    }

    if (password === "") {
      nextErrors.password = messages.auth.passwordRequired;
    }

    setFieldErrors(nextErrors);
    setFormError(null);

    if (nextErrors.email !== undefined || nextErrors.password !== undefined) {
      return;
    }

    setPending("password");

    try {
      const { data, error } = await authClient.signIn.email({
        email: email.trim(),
        password,
      });

      if (error) {
        setFormError(mapAuthError(error));
        return;
      }

      const outcome = afterPassword(data, returnTo);

      if (outcome.kind === "totp") {
        setPassword("");
        setStep(outcome);
        return;
      }

      finishSignIn(await fetchVendorMe());
    } catch {
      setFormError(messages.errors.generic);
    } finally {
      setPending(null);
    }
  }

  async function handlePasskeySignIn(): Promise<void> {
    if (pending !== null) {
      return;
    }

    setFormError(null);
    setPending("passkey");

    try {
      const { error } = await authClient.signIn.passkey();

      if (error) {
        if (!isPasskeyCancellation(error)) {
          setFormError(mapAuthError(error));
        }

        return;
      }

      finishSignIn(await fetchVendorMe());
    } catch {
      setFormError(messages.errors.generic);
    } finally {
      setPending(null);
    }
  }

  function handleVerified(): void {
    router.replace(returnTo);
    router.refresh();
  }

  function toggleBackupCode(): void {
    if (step.kind !== "totp") {
      return;
    }

    setStep({ ...step, useBackupCode: !step.useBackupCode });
  }

  function backToCredentials(): void {
    setStep({ kind: "credentials" });
    setFormError(null);
    setFieldErrors({});
  }

  function openForgotPassword(): void {
    setShowForgotPassword(true);
    setFormError(null);
    setFieldErrors({});
  }

  return (
    <div className="grid gap-4">
      {reason === "inactive" ? (
        <Alert className="border-destructive/40 bg-destructive/5 text-destructive">
          {messages.auth.inactiveReason}
        </Alert>
      ) : null}
      {reason === "session_expired" ? (
        <Alert className="border-warning/40 bg-warning/10">
          {messages.auth.sessionExpiredReason}
        </Alert>
      ) : null}
      {outage ? (
        <Alert className="border-warning/40 bg-warning/10">
          <p className="font-medium">{messages.errors.serviceUnavailable}</p>
          <p className="text-muted-foreground">{messages.errors.serviceUnavailableDescription}</p>
        </Alert>
      ) : null}
      {showForgotPassword ? (
        <ForgotPasswordForm onBack={() => setShowForgotPassword(false)} />
      ) : step.kind === "totp" ? (
        <TwoFactorForm
          useBackupCode={step.useBackupCode}
          onToggleBackupCode={toggleBackupCode}
          onBack={backToCredentials}
          onVerified={handleVerified}
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{messages.auth.loginTitle}</CardTitle>
            <CardDescription>{messages.auth.loginDescription}</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4"
              onSubmit={(event) => void handlePasswordSubmit(event)}
              noValidate
            >
              <Field
                label={messages.auth.emailLabel}
                htmlFor={EMAIL_ID}
                {...(fieldErrors.email ? { error: fieldErrors.email } : {})}
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
                    setFieldErrors((current) => ({ ...current, email: "" }));
                  }}
                  aria-describedby={fieldErrors.email ? `${EMAIL_ID}-error` : undefined}
                  aria-invalid={fieldErrors.email ? true : undefined}
                  disabled={pending !== null}
                />
              </Field>
              <Field
                label={messages.auth.passwordLabel}
                htmlFor={PASSWORD_ID}
                {...(fieldErrors.password ? { error: fieldErrors.password } : {})}
              >
                <PasswordInput
                  id={PASSWORD_ID}
                  name="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setFieldErrors((current) => ({ ...current, password: "" }));
                  }}
                  aria-describedby={fieldErrors.password ? `${PASSWORD_ID}-error` : undefined}
                  aria-invalid={fieldErrors.password ? true : undefined}
                  disabled={pending !== null}
                />
              </Field>
              <div aria-live="polite" className="min-h-0 text-sm text-destructive">
                {formError}
              </div>
              <Button type="submit" disabled={pending !== null}>
                {pending === "password" ? <Spinner className="h-4 w-4" /> : null}
                {pending === "password" ? messages.auth.signingIn : messages.auth.signIn}
              </Button>
              {passkeyAvailable ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handlePasskeySignIn()}
                  disabled={pending !== null}
                >
                  {pending === "passkey" ? <Spinner className="h-4 w-4" /> : null}
                  {pending === "passkey" ? messages.auth.passkeyPending : messages.auth.passkey}
                </Button>
              ) : mounted ? (
                <p className="text-sm text-muted-foreground">{messages.auth.passkeyUnavailable}</p>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={openForgotPassword}
                disabled={pending !== null}
              >
                {messages.auth.forgotPassword}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
