"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Spinner,
} from "@partner-coder/ui";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { messages } from "@/lib/messages";

import { handleConsoleAuthError } from "./auth-error";

export function RevokeSessionsButton() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleOpenChange(next: boolean): void {
    if (pending) {
      return;
    }

    setOpen(next);

    if (!next) {
      setError(null);
    }
  }

  async function handleConfirm(event: ReactMouseEvent<HTMLButtonElement>): Promise<void> {
    event.preventDefault();

    if (pending) {
      return;
    }

    setPending(true);
    setError(null);

    try {
      const { error: requestError } = await authClient.revokeOtherSessions();

      if (requestError) {
        const message = handleConsoleAuthError(requestError, router, pathname);
        if (message === null) {
          setOpen(false);
          return;
        }

        setError(message);
        return;
      }

      setOpen(false);
      toast.success(messages.security.sessionsRevokeSuccess);
    } catch {
      setError(messages.errors.generic);
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{messages.security.sessionsTitle}</CardTitle>
        <CardDescription>{messages.security.sessionsDescription}</CardDescription>
      </CardHeader>
      <CardContent>
        <AlertDialog open={open} onOpenChange={handleOpenChange}>
          <AlertDialogTrigger asChild>
            <Button type="button" variant="outline">
              {messages.security.sessionsRevoke}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{messages.security.sessionsRevokeTitle}</AlertDialogTitle>
              <AlertDialogDescription>
                {messages.security.sessionsRevokeDescription}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div aria-live="polite" className="min-h-0 text-sm text-destructive">
              {error}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>{messages.common.cancel}</AlertDialogCancel>
              <AlertDialogAction disabled={pending} onClick={(event) => void handleConfirm(event)}>
                {pending ? <Spinner className="h-4 w-4" /> : null}
                {pending
                  ? messages.security.sessionsRevokePending
                  : messages.security.sessionsRevokeConfirm}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
