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
import type { VendorInvoice, VendorPaymentMethod } from "@/lib/vendor-finance-types";

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

const INVOICE_ID = "payment-invoice";
const DATE_ID = "payment-date";
const AMOUNT_ID = "payment-amount";
const METHOD_ID = "payment-method";
const REFERENCE_ID = "payment-reference";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function RecordPaymentDialog({ invoices }: { invoices: readonly VendorInvoice[] }) {
  const router = useRouter();
  const fetchWithStepUp = useStepUpFetch();
  const payable = invoices.filter(
    (invoice) => invoice.status !== "draft" && invoice.status !== "void",
  );
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [invoiceId, setInvoiceId] = useState(payable[0]?.id ?? "");
  const [paidOn, setPaidOn] = useState(today());
  const [amountRubles, setAmountRubles] = useState("");
  const [method, setMethod] = useState<VendorPaymentMethod>("bank_transfer");
  const [reference, setReference] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  function reset(): void {
    setAmountRubles("");
    setReference("");
    setErrors({});
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending) return;

    const nextErrors: Record<string, string> = {};
    if (invoiceId === "") nextErrors.invoice = messages.paymentForm.invoiceRequired;
    if (!/^\d+([.,]\d{1,2})?$/.test(amountRubles.trim())) {
      nextErrors.amount = messages.paymentForm.amountFormat;
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    const amountKopecks = Math.round(Number(amountRubles.trim().replace(",", ".")) * 100);
    if (!Number.isSafeInteger(amountKopecks) || amountKopecks <= 0) {
      setErrors({ amount: messages.paymentForm.amountFormat });
      return;
    }

    setPending(true);
    setErrors({});
    try {
      const response = await fetchWithStepUp("/v1/vendor/payments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          invoiceId,
          paidOn,
          amountKopecks: amountKopecks.toString(),
          method,
          ...(reference.trim() === "" ? {} : { reference: reference.trim() }),
        }),
      });
      if (response.ok) {
        toast.success(messages.paymentForm.created);
        reset();
        setOpen(false);
        router.refresh();
        return;
      }
      toast.error(messages.errors.createFailed);
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
        <Button type="button" variant="outline" disabled={payable.length === 0}>
          {messages.clientCard.recordPayment}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form className="grid gap-4" onSubmit={(event) => void handleSubmit(event)} noValidate>
          <DialogHeader>
            <DialogTitle>{messages.paymentForm.title}</DialogTitle>
            <DialogDescription>{messages.paymentForm.description}</DialogDescription>
          </DialogHeader>
          <Field
            label={messages.paymentForm.invoiceLabel}
            htmlFor={INVOICE_ID}
            {...(errors.invoice ? { error: errors.invoice } : {})}
          >
            <select
              id={INVOICE_ID}
              className={selectClass}
              value={invoiceId}
              onChange={(event) => setInvoiceId(event.target.value)}
              disabled={pending}
            >
              {payable.map((invoice) => (
                <option key={invoice.id} value={invoice.id}>
                  {invoice.number} · {invoice.amountKopecks} коп.
                </option>
              ))}
            </select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={messages.paymentForm.dateLabel} htmlFor={DATE_ID}>
              <Input
                id={DATE_ID}
                type="date"
                value={paidOn}
                onChange={(event) => setPaidOn(event.target.value)}
                disabled={pending}
              />
            </Field>
            <Field
              label={messages.paymentForm.amountLabel}
              htmlFor={AMOUNT_ID}
              {...(errors.amount ? { error: errors.amount } : {})}
            >
              <Input
                id={AMOUNT_ID}
                value={amountRubles}
                onChange={(event) => setAmountRubles(event.target.value)}
                disabled={pending}
                inputMode="decimal"
                aria-invalid={errors.amount ? true : undefined}
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={messages.paymentForm.methodLabel} htmlFor={METHOD_ID}>
              <select
                id={METHOD_ID}
                className={selectClass}
                value={method}
                onChange={(event) => setMethod(event.target.value as VendorPaymentMethod)}
                disabled={pending}
              >
                {Object.entries(messages.paymentMethods).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={messages.paymentForm.referenceLabel} htmlFor={REFERENCE_ID}>
              <Input
                id={REFERENCE_ID}
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                disabled={pending}
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
              {pending ? messages.paymentForm.pending : messages.paymentForm.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
