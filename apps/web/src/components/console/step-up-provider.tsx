"use client";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Spinner,
} from "@partner-coder/ui";
import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useRef, useState } from "react";

import { messages } from "@/lib/messages";
import { readVendorErrorCode } from "@/lib/vendor-finance-types";

const STEP_UP_PATH = "/v1/vendor/auth/step-up";

type StepUpContextValue = {
  fetchWithStepUp: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

const StepUpContext = createContext<StepUpContextValue | null>(null);

export function useStepUpFetch(): StepUpContextValue["fetchWithStepUp"] {
  const context = useContext(StepUpContext);
  return context?.fetchWithStepUp ?? fetch;
}

export function StepUpProvider({ children }: { children: ReactNode }) {
  const [password, setPassword] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolver = useRef<((confirmed: boolean) => void) | null>(null);

  const requestConfirmation = useCallback((): Promise<boolean> => {
    return new Promise((resolve) => {
      resolver.current = resolve;
      setPassword("");
      setError(null);
      setOpen(true);
    });
  }, []);

  const settle = useCallback((confirmed: boolean) => {
    resolver.current?.(confirmed);
    resolver.current = null;
    setOpen(false);
  }, []);

  const fetchWithStepUp = useCallback(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const response = await fetch(input, init);
      if (response.status !== 403) {
        return response;
      }
      const body: unknown = await response
        .clone()
        .json()
        .catch(() => null);
      if (readVendorErrorCode(body) !== "vendor_step_up_required") {
        return response;
      }
      const confirmed = await requestConfirmation();
      if (!confirmed) {
        return response;
      }
      return fetch(input, init);
    },
    [requestConfirmation],
  );

  async function submit(): Promise<void> {
    if (password === "" || pending) {
      setError(messages.stepUp.passwordRequired);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch(STEP_UP_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (response.ok) {
        settle(true);
        return;
      }
      const body: unknown = await response.json().catch(() => null);
      setError(
        readVendorErrorCode(body) === "invalid_password"
          ? messages.errors.invalidPassword
          : messages.stepUp.failed,
      );
    } catch {
      setError(messages.errors.generic);
    } finally {
      setPending(false);
    }
  }

  return (
    <StepUpContext.Provider value={{ fetchWithStepUp }}>
      {children}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && !pending) {
            settle(false);
          }
        }}
      >
        <DialogContent>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
            noValidate
          >
            <DialogHeader>
              <DialogTitle>{messages.stepUp.title}</DialogTitle>
              <DialogDescription>{messages.stepUp.description}</DialogDescription>
            </DialogHeader>
            <Field
              label={messages.stepUp.passwordLabel}
              htmlFor="step-up-password"
              {...(error ? { error } : {})}
            >
              <Input
                id="step-up-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={pending}
                autoComplete="current-password"
                autoFocus
                aria-invalid={error ? true : undefined}
              />
            </Field>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => settle(false)}
                disabled={pending}
              >
                {messages.stepUp.cancel}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? <Spinner className="h-4 w-4" /> : null}
                {pending ? messages.stepUp.pending : messages.stepUp.submit}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </StepUpContext.Provider>
  );
}
