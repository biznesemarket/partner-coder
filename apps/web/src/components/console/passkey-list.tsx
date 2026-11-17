"use client";

import type { Passkey } from "@better-auth/passkey/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  EmptyState,
  Field,
  Input,
  Spinner,
} from "@partner-coder/ui";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";

import { isPasskeyCancellation } from "@/components/auth/passkey-error";
import { authClient } from "@/lib/auth-client";
import { formatDateTime } from "@/lib/format";
import { messages } from "@/lib/messages";
import { passkeyLabel } from "@/lib/passkeys";

import { handleConsoleAuthError } from "./auth-error";

const NAME_ID = "passkey-name";

const UNSUPPORTED_ID = "passkey-unsupported";

const UNSUPPORTED_PASSKEY_CODES = new Set([
  "ERROR_AUTHENTICATOR_NO_SUPPORTED_PUBKEYCREDPARAMS_ALG",
  "ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT",
  "ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT",
]);

function readErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function readErrorName(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("name" in error)) {
    return null;
  }

  const name = (error as { name?: unknown }).name;
  return typeof name === "string" ? name : null;
}

function isUnsupportedPasskey(error: unknown): boolean {
  const code = readErrorCode(error);
  if (code !== null && UNSUPPORTED_PASSKEY_CODES.has(code)) {
    return true;
  }

  if (readErrorName(error) === "NotSupportedError") {
    return true;
  }

  if (typeof error !== "object" || error === null || !("cause" in error)) {
    return false;
  }

  return readErrorName((error as { cause?: unknown }).cause) === "NotSupportedError";
}

function subscribeNoop(): () => void {
  return () => undefined;
}

function getPasskeySupport(): boolean {
  return typeof window !== "undefined" && "PublicKeyCredential" in window;
}

function getServerPasskeySupport(): boolean {
  return false;
}

function getMounted(): boolean {
  return true;
}

function getServerMounted(): boolean {
  return false;
}

type PasskeysResult =
  { kind: "ok"; passkeys: Passkey[] } | { kind: "error"; message: string } | { kind: "redirect" };

export function PasskeyList() {
  const router = useRouter();
  const pathname = usePathname();
  const mounted = useSyncExternalStore(subscribeNoop, getMounted, getServerMounted);
  const passkeyAvailable = useSyncExternalStore(
    subscribeNoop,
    getPasskeySupport,
    getServerPasskeySupport,
  );
  const [passkeys, setPasskeys] = useState<Passkey[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState<string>(messages.security.passkeyDefaultName);
  const [nameError, setNameError] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [addPending, setAddPending] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Passkey | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletePending, setDeletePending] = useState(false);

  const requestPasskeys = useCallback(async (): Promise<PasskeysResult> => {
    try {
      const { data, error } = await authClient.passkey.listUserPasskeys();

      if (error) {
        const message = handleConsoleAuthError(error, router, pathname);
        return message === null ? { kind: "redirect" } : { kind: "error", message };
      }

      return { kind: "ok", passkeys: Array.isArray(data) ? data : [] };
    } catch {
      return { kind: "error", message: messages.security.passkeysLoadFailed };
    }
  }, [pathname, router]);

  const applyResult = useCallback((result: PasskeysResult): void => {
    if (result.kind === "ok") {
      setPasskeys(result.passkeys);
      setLoadError(null);
      return;
    }

    if (result.kind === "error") {
      setLoadError(result.message);
    }
  }, []);

  const loadPasskeys = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);

    const result = await requestPasskeys();
    applyResult(result);
    setLoading(false);
  }, [applyResult, requestPasskeys]);

  useEffect(() => {
    let cancelled = false;

    void requestPasskeys().then((result) => {
      if (cancelled) {
        return;
      }

      applyResult(result);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [applyResult, requestPasskeys]);

  function handleAddOpenChange(open: boolean): void {
    if (addPending) {
      return;
    }

    setAddOpen(open);

    if (!open) {
      setName(messages.security.passkeyDefaultName);
      setNameError(null);
      setAddError(null);
    }
  }

  async function handleAdd(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (addPending) {
      return;
    }

    const trimmed = name.trim();

    if (trimmed === "") {
      setNameError(messages.security.passkeyNameRequired);
      return;
    }

    setNameError(null);
    setAddError(null);
    setAddPending(true);

    try {
      const { error } = await authClient.passkey.addPasskey({ name: trimmed });

      if (error) {
        if (isPasskeyCancellation(error)) {
          return;
        }

        if (isUnsupportedPasskey(error)) {
          setAddError(messages.errors.passkeyUnsupported);
          return;
        }

        const message = handleConsoleAuthError(error, router, pathname);
        if (message === null) {
          setAddOpen(false);
          return;
        }

        setAddError(message);
        return;
      }

      setAddOpen(false);
      setName(messages.security.passkeyDefaultName);
      toast.success(messages.security.passkeyAdded);
      await loadPasskeys();
    } catch (error) {
      if (!isPasskeyCancellation(error)) {
        setAddError(
          isUnsupportedPasskey(error)
            ? messages.errors.passkeyUnsupported
            : messages.errors.generic,
        );
      }
    } finally {
      setAddPending(false);
    }
  }

  function handleDeleteOpenChange(open: boolean): void {
    if (deletePending) {
      return;
    }

    if (!open) {
      setDeleteTarget(null);
      setDeleteError(null);
    }
  }

  async function handleDelete(): Promise<void> {
    if (deleteTarget === null || deletePending) {
      return;
    }

    setDeletePending(true);
    setDeleteError(null);

    try {
      const { error } = await authClient.passkey.deletePasskey({ id: deleteTarget.id });

      if (error) {
        const message = handleConsoleAuthError(error, router, pathname);
        if (message !== null) {
          setDeleteError(message);
        }

        return;
      }

      setDeleteTarget(null);
      toast.success(messages.security.passkeyDeleted);
      await loadPasskeys();
    } catch {
      setDeleteError(messages.errors.generic);
    } finally {
      setDeletePending(false);
    }
  }

  const deleteLabel = deleteTarget === null ? "" : passkeyLabel(deleteTarget);

  return (
    <section aria-labelledby="passkeys-heading" className="grid gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid gap-1">
          <h3 id="passkeys-heading" className="text-base font-semibold">
            {messages.security.passkeysTitle}
          </h3>
          <p className="text-sm text-muted-foreground">{messages.security.passkeysDescription}</p>
          {mounted && !passkeyAvailable ? (
            <p id={UNSUPPORTED_ID} className="text-xs text-muted-foreground">
              {messages.security.passkeyUnsupported}
            </p>
          ) : null}
        </div>
        <Dialog open={addOpen} onOpenChange={handleAddOpenChange}>
          <DialogTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!passkeyAvailable}
              aria-describedby={mounted && !passkeyAvailable ? UNSUPPORTED_ID : undefined}
            >
              {messages.security.passkeyAdd}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{messages.security.passkeyAddTitle}</DialogTitle>
              <DialogDescription>{messages.security.passkeyAddDescription}</DialogDescription>
            </DialogHeader>
            <form className="grid gap-4" onSubmit={(event) => void handleAdd(event)} noValidate>
              <Field
                label={messages.security.passkeyNameLabel}
                htmlFor={NAME_ID}
                {...(nameError ? { error: nameError } : {})}
              >
                <Input
                  id={NAME_ID}
                  name="name"
                  autoComplete="off"
                  autoFocus
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    setNameError(null);
                    setAddError(null);
                  }}
                  disabled={addPending}
                  aria-describedby={nameError ? `${NAME_ID}-error` : undefined}
                  aria-invalid={nameError ? true : undefined}
                />
              </Field>
              <div aria-live="polite" className="min-h-0 text-sm text-destructive">
                {addError}
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline" disabled={addPending}>
                    {messages.common.cancel}
                  </Button>
                </DialogClose>
                <Button type="submit" disabled={addPending || !passkeyAvailable}>
                  {addPending ? <Spinner className="h-4 w-4" /> : null}
                  {addPending ? messages.security.passkeyAddPending : messages.security.passkeyAdd}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      <div aria-live="polite" className="sr-only">
        {loading && passkeys === null ? messages.security.passkeysLoading : ""}
      </div>
      {loading && passkeys === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" />
          {messages.security.passkeysLoading}
        </div>
      ) : loadError !== null ? (
        <div className="grid justify-items-start gap-2">
          <p role="alert" className="text-sm text-destructive">
            {loadError}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => void loadPasskeys()}>
            {messages.common.retry}
          </Button>
        </div>
      ) : passkeys !== null && passkeys.length === 0 ? (
        <EmptyState
          title={messages.security.passkeysEmptyTitle}
          description={messages.security.passkeysEmptyDescription}
        />
      ) : (
        <ul className="grid gap-2">
          {passkeys?.map((passkey) => (
            <li
              key={passkey.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-4"
            >
              <div className="grid gap-1">
                <p className="text-sm font-medium">{passkeyLabel(passkey)}</p>
                <p className="text-xs text-muted-foreground">
                  {messages.security.passkeyCreatedLabel}: {formatDateTime(passkey.createdAt)}
                </p>
                <Badge variant="outline" className="w-fit">
                  {passkey.backedUp
                    ? messages.security.passkeyBackedUp
                    : messages.security.passkeyNotBackedUp}
                </Badge>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDeleteError(null);
                  setDeleteTarget(passkey);
                }}
                disabled={deletePending}
                aria-label={`${messages.security.passkeyDelete}: ${passkeyLabel(passkey)}`}
              >
                {messages.security.passkeyDelete}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <AlertDialog open={deleteTarget !== null} onOpenChange={handleDeleteOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{messages.security.passkeyDeleteTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {messages.security.passkeyDeleteDescription(deleteLabel)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div aria-live="polite" className="min-h-0 text-sm text-destructive">
            {deleteError}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletePending}>{messages.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              disabled={deletePending}
              onClick={(event) => {
                event.preventDefault();
                void handleDelete();
              }}
            >
              {deletePending ? <Spinner className="h-4 w-4" /> : null}
              {deletePending
                ? messages.security.passkeyDeletePending
                : messages.security.passkeyDelete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
