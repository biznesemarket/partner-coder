"use client";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Field,
  Input,
  Spinner,
} from "@partner-coder/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";

import { useStepUpFetch } from "@/components/console/step-up-provider";
import { messages } from "@/lib/messages";
import type { VendorSubscription } from "@/lib/vendor-finance-types";

const START_ID = "renew-start";
const END_ID = "renew-end";

function addMonth(date: string): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(year, month, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const clamped = Math.min(day, lastDay);
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}-${String(clamped).padStart(2, "0")}`;
}

export function RenewSubscriptionDialog({ subscription }: { subscription: VendorSubscription }) {
  const router = useRouter();
  const fetchWithStepUp = useStepUpFetch();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [periodStart, setPeriodStart] = useState(subscription.periodEnd);
  const [periodEnd, setPeriodEnd] = useState(addMonth(subscription.periodEnd));
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending) return;
    if (periodEnd <= periodStart) {
      setErrors({ end: messages.renewForm.datesInvalid });
      return;
    }

    setPending(true);
    setErrors({});
    try {
      const response = await fetchWithStepUp(
        `/v1/vendor/subscriptions/${encodeURIComponent(subscription.id)}/renew`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ periodStart, periodEnd }),
        },
      );
      if (response.ok) {
        toast.success(messages.renewForm.renewed);
        setOpen(false);
        router.refresh();
        return;
      }
      toast.error(messages.errors.generic);
    } catch {
      toast.error(messages.errors.generic);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setErrors({});
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          {messages.clientCard.renew}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form className="grid gap-4" onSubmit={(event) => void handleSubmit(event)} noValidate>
          <DialogHeader>
            <DialogTitle>{messages.renewForm.title}</DialogTitle>
            <DialogDescription>{messages.renewForm.description}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={messages.renewForm.startLabel} htmlFor={START_ID}>
              <Input
                id={START_ID}
                type="date"
                value={periodStart}
                onChange={(event) => setPeriodStart(event.target.value)}
                disabled={pending}
              />
            </Field>
            <Field
              label={messages.renewForm.endLabel}
              htmlFor={END_ID}
              {...(errors.end ? { error: errors.end } : {})}
            >
              <Input
                id={END_ID}
                type="date"
                value={periodEnd}
                onChange={(event) => setPeriodEnd(event.target.value)}
                disabled={pending}
                aria-invalid={errors.end ? true : undefined}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              {messages.common.cancel}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner className="h-4 w-4" /> : null}
              {pending ? messages.renewForm.pending : messages.renewForm.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
