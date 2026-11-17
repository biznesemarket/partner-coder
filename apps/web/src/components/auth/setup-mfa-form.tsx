"use client";

import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  CodeInput,
  CopyButton,
  Field,
  Label,
  PasswordInput,
  Separator,
  Spinner,
  normalizeOtp,
} from "@partner-coder/ui";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { LogoutButton } from "@/components/console/logout-button";
import { authClient } from "@/lib/auth-client";
import { mapAuthError } from "@/lib/errors";
import { messages } from "@/lib/messages";
import { parseTotpUri } from "@/lib/totp";

const PASSWORD_ID = "setup-mfa-password";

const CODE_ID = "setup-mfa-code";

const SAVED_ID = "setup-mfa-saved";

const CODE_LENGTH = 6;

type Enrollment = {
  totpUri: string;
  secret: string;
  backupCodes: string[];
};

type Screen = { kind: "password" } | { kind: "codes"; enrollment: Enrollment } | { kind: "verify" };

type SetupMfaFormProps = {
  returnTo: string;
};

const STEP_TITLES: Record<Screen["kind"], string> = {
  password: messages.auth.setupMfaPasswordTitle,
  codes: messages.auth.setupMfaCodesTitle,
  verify: messages.auth.setupMfaVerifyTitle,
};

const STEP_DESCRIPTIONS: Record<Screen["kind"], string> = {
  password: messages.auth.setupMfaPasswordDescription,
  codes: messages.auth.setupMfaCodesDescription,
  verify: messages.auth.setupMfaVerifyDescription,
};

function downloadBackupCodes(codes: string[]): void {
  const blob = new Blob([`${codes.join("\n")}\n`], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = messages.auth.setupMfaBackupCodesFile;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function isUnauthorized(error: {
  status?: number | null | undefined;
  statusCode?: number | null | undefined;
}): boolean {
  return error.status === 401 || error.statusCode === 401;
}

export function SetupMfaForm({ returnTo }: SetupMfaFormProps) {
  const router = useRouter();
  const headingRef = useRef<HTMLDivElement>(null);
  const previousKind = useRef<Screen["kind"]>("password");
  const [screen, setScreen] = useState<Screen>({ kind: "password" });
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [codesSaved, setCodesSaved] = useState(false);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (previousKind.current === screen.kind) {
      return;
    }

    previousKind.current = screen.kind;
    headingRef.current?.focus();
  }, [screen.kind]);

  function goToLogin(): void {
    router.replace(`/login?returnTo=${encodeURIComponent(returnTo)}`);
    router.refresh();
  }

  function restart(): void {
    setScreen({ kind: "password" });
    setPassword("");
    setPasswordError(null);
    setCodesSaved(false);
    setCode("");
    setCodeError(null);
    setFormError(null);
  }

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (pending) {
      return;
    }

    if (password === "") {
      setPasswordError(messages.auth.passwordRequired);
      return;
    }

    setPasswordError(null);
    setFormError(null);
    setPending(true);

    try {
      const { data, error } = await authClient.twoFactor.enable({ password, method: "totp" });

      if (error) {
        if (error.code === "TOTP_ALREADY_ENABLED") {
          router.replace(returnTo);
          router.refresh();
          return;
        }

        if (isUnauthorized(error)) {
          goToLogin();
          return;
        }

        setFormError(mapAuthError(error));
        return;
      }

      if (!data || data.method !== "totp" || data.totpURI === "") {
        setFormError(messages.auth.setupMfaCodesMissing);
        return;
      }

      const totp = parseTotpUri(data.totpURI);

      if (totp.secret === "") {
        setFormError(messages.auth.setupMfaCodesMissing);
        return;
      }

      setScreen({
        kind: "codes",
        enrollment: {
          totpUri: data.totpURI,
          secret: totp.secret,
          backupCodes: data.backupCodes,
        },
      });
      setCodesSaved(false);
    } catch {
      setFormError(messages.errors.generic);
    } finally {
      setPassword("");
      setPending(false);
    }
  }

  function handleContinue(): void {
    if (screen.kind !== "codes" || !codesSaved) {
      return;
    }

    setCode("");
    setCodeError(null);
    setFormError(null);
    setScreen({ kind: "verify" });
  }

  async function handleVerify(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (pending) {
      return;
    }

    const normalized = normalizeOtp(code);

    if (normalized.length !== CODE_LENGTH) {
      setCodeError(messages.auth.codeRequired);
      return;
    }

    setCodeError(null);
    setFormError(null);
    setPending(true);

    try {
      const { error } = await authClient.twoFactor.verifyTotp({ code: normalized });

      if (error) {
        if (isUnauthorized(error)) {
          goToLogin();
          return;
        }

        setFormError(mapAuthError(error));
        return;
      }

      router.replace(`${returnTo}?enrolled=1`);
      router.refresh();
    } catch {
      setFormError(messages.errors.generic);
    } finally {
      setPending(false);
    }
  }

  function renderPasswordStep() {
    return (
      <form
        className="grid gap-4"
        onSubmit={(event) => void handlePasswordSubmit(event)}
        noValidate
      >
        <Field
          label={messages.auth.passwordLabel}
          htmlFor={PASSWORD_ID}
          {...(passwordError ? { error: passwordError } : {})}
        >
          <PasswordInput
            id={PASSWORD_ID}
            name="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              setPasswordError(null);
              setFormError(null);
            }}
            aria-describedby={passwordError ? `${PASSWORD_ID}-error` : undefined}
            aria-invalid={passwordError ? true : undefined}
            disabled={pending}
          />
        </Field>
        <div aria-live="polite" className="min-h-0 text-sm text-destructive">
          {formError}
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner className="h-4 w-4" /> : null}
          {pending ? messages.auth.setupMfaPasswordPending : messages.auth.setupMfaPasswordSubmit}
        </Button>
      </form>
    );
  }

  function renderCodesStep(enrollment: Enrollment) {
    return (
      <div className="grid gap-4">
        <div className="grid justify-items-center gap-2">
          <div
            className="rounded-md bg-white p-3"
            role="img"
            aria-label={messages.auth.setupMfaQrLabel}
          >
            <QRCodeSVG
              value={enrollment.totpUri}
              size={176}
              level="M"
              marginSize={2}
              title={messages.auth.setupMfaQrLabel}
            />
          </div>
        </div>
        <div className="grid gap-2">
          <span id="setup-mfa-secret-label" className="text-sm font-medium">
            {messages.auth.setupMfaSecretLabel}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <code
              aria-labelledby="setup-mfa-secret-label"
              className="select-all break-all rounded-md bg-muted px-2 py-1 font-mono text-sm"
            >
              {enrollment.secret}
            </code>
            <CopyButton value={enrollment.secret} label={messages.auth.setupMfaSecretCopy} />
          </div>
          <p className="text-xs text-muted-foreground">{messages.auth.setupMfaSecretHint}</p>
        </div>
        <Alert className="border-warning/40 bg-warning/10">
          {messages.auth.setupMfaSecretWarning}
        </Alert>
        <div className="grid gap-2">
          <h3 className="text-sm font-medium">{messages.auth.setupMfaBackupCodesTitle}</h3>
          <p className="text-xs text-muted-foreground">
            {messages.auth.setupMfaBackupCodesDescription}
          </p>
          <ol
            aria-label={messages.auth.setupMfaBackupCodesTitle}
            className="grid grid-cols-2 gap-2 font-mono text-sm select-all"
          >
            {enrollment.backupCodes.map((backupCode, index) => (
              <li
                key={`${index}-${backupCode}`}
                className="rounded-md border bg-muted/40 px-2 py-1"
              >
                {backupCode}
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-2">
            <CopyButton
              value={enrollment.backupCodes.join("\n")}
              label={messages.auth.setupMfaBackupCodesCopy}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => downloadBackupCodes(enrollment.backupCodes)}
            >
              {messages.auth.setupMfaBackupCodesDownload}
            </Button>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <Checkbox
            id={SAVED_ID}
            checked={codesSaved}
            onCheckedChange={(checked) => setCodesSaved(checked === true)}
          />
          <Label htmlFor={SAVED_ID} className="text-sm leading-5">
            {messages.auth.setupMfaBackupSaved}
          </Label>
        </div>
        <div aria-live="polite" className="min-h-0 text-sm text-destructive">
          {formError}
        </div>
        <Button type="button" onClick={handleContinue} disabled={!codesSaved}>
          {messages.auth.setupMfaContinue}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={restart}>
          {messages.auth.setupMfaRestart}
        </Button>
      </div>
    );
  }

  function renderVerifyStep() {
    return (
      <form className="grid gap-4" onSubmit={(event) => void handleVerify(event)} noValidate>
        <Field
          label={messages.auth.codeLabel}
          htmlFor={CODE_ID}
          hint={messages.auth.codeHint}
          {...(codeError ? { error: codeError } : {})}
        >
          <CodeInput
            id={CODE_ID}
            name="code"
            value={code}
            onChange={(next) => {
              setCode(next);
              setCodeError(null);
              setFormError(null);
            }}
            autoFocus
            disabled={pending}
            aria-describedby={codeError ? `${CODE_ID}-error` : `${CODE_ID}-hint`}
            {...(codeError ? { "aria-invalid": true } : {})}
          />
        </Field>
        <div aria-live="polite" className="min-h-0 text-sm text-destructive">
          {formError}
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner className="h-4 w-4" /> : null}
          {pending ? messages.auth.setupMfaVerifyPending : messages.auth.setupMfaVerifySubmit}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={restart} disabled={pending}>
          {messages.auth.setupMfaRestart}
        </Button>
      </form>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-1 text-center">
        <h1 className="text-xl font-semibold tracking-tight">{messages.auth.setupMfaTitle}</h1>
        <p className="text-sm text-muted-foreground">{messages.auth.setupMfaDescription}</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle ref={headingRef} tabIndex={-1} role="heading" aria-level={2}>
            {STEP_TITLES[screen.kind]}
          </CardTitle>
          <CardDescription>{STEP_DESCRIPTIONS[screen.kind]}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {screen.kind === "password"
            ? renderPasswordStep()
            : screen.kind === "codes"
              ? renderCodesStep(screen.enrollment)
              : renderVerifyStep()}
          <Separator />
          <div className="flex justify-center">
            <LogoutButton />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
