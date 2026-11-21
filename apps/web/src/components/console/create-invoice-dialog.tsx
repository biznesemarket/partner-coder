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
import { readVendorErrorCode, type VendorContract } from "@/lib/vendor-finance-types";

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

const NUMBER_ID = "invoice-number";
const CONTRACT_ID = "invoice-contract";
const ISSUED_ID = "invoice-issued";
const DUE_ID = "invoice-due";
const AMOUNT_ID = "invoice-amount";
const PDF_ID = "invoice-pdf";
const STATUS_ID = "invoice-status";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function CreateInvoiceDialog({
  customerId,
  contracts,
}: {
  customerId: string;
  contracts: readonly VendorContract[];
}) {
  const router = useRouter();
  const fetchWithStepUp = useStepUpFetch();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [number, setNumber] = useState("");
  const [contractId, setContractId] = useState(contracts[0]?.id ?? "");
  const [issuedOn, setIssuedOn] = useState(today());
  const [dueOn, setDueOn] = useState(today());
  const [amountRubles, setAmountRubles] = useState("");
  const [pdfUrl, setPdfUrl] = useState("");
  const [status, setStatus] = useState<"draft" | "issued">("issued");
  const [errors, setErrors] = useState<Record<string, string>>({});

  function reset(): void {
    setNumber("");
    setAmountRubles("");
    setPdfUrl("");
    setErrors({});
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending) return;

    const nextErrors: Record<string, string> = {};
    if (number.trim() === "") nextErrors.number = messages.invoiceForm.numberRequired;
    if (contractId === "") nextErrors.contract = messages.invoiceForm.contractRequired;
    if (!/^\d+([.,]\d{1,2})?$/.test(amountRubles.trim())) {
      nextErrors.amount = messages.invoiceForm.amountFormat;
    }
    if (dueOn < issuedOn) nextErrors.due = messages.invoiceForm.datesInvalid;
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    const amountKopecks = Math.round(Number(amountRubles.trim().replace(",", ".")) * 100);
    if (!Number.isSafeInteger(amountKopecks) || amountKopecks <= 0) {
      setErrors({ amount: messages.invoiceForm.amountFormat });
      return;
    }

    setPending(true);
    setErrors({});
    try {
      const response = await fetchWithStepUp("/v1/vendor/invoices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customerId,
          contractId,
          number: number.trim(),
          issuedOn,
          dueOn,
          amountKopecks: amountKopecks.toString(),
          status,
          ...(pdfUrl.trim() === "" ? {} : { pdfUrl: pdfUrl.trim() }),
        }),
      });
      const body: unknown = await response.json().catch(() => null);

      if (response.ok) {
        toast.success(messages.invoiceForm.created);
        reset();
        setOpen(false);
        router.refresh();
        return;
      }

      if (readVendorErrorCode(body) === "vendor_invoice_number_exists") {
        setErrors({ number: "Счёт с таким номером уже существует" });
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
        <Button type="button" disabled={contracts.length === 0}>
          {messages.clientCard.createInvoice}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form className="grid gap-4" onSubmit={(event) => void handleSubmit(event)} noValidate>
          <DialogHeader>
            <DialogTitle>{messages.invoiceForm.title}</DialogTitle>
            <DialogDescription>{messages.invoiceForm.description}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={messages.invoiceForm.numberLabel}
              htmlFor={NUMBER_ID}
              {...(errors.number ? { error: errors.number } : {})}
            >
              <Input
                id={NUMBER_ID}
                value={number}
                onChange={(event) => setNumber(event.target.value)}
                disabled={pending}
                autoFocus
                aria-invalid={errors.number ? true : undefined}
              />
            </Field>
            <Field
              label={messages.invoiceForm.statusLabel}
              htmlFor={STATUS_ID}
              {...(errors.status ? { error: errors.status } : {})}
            >
              <select
                id={STATUS_ID}
                className={selectClass}
                value={status}
                onChange={(event) => setStatus(event.target.value as "draft" | "issued")}
                disabled={pending}
              >
                <option value="draft">{messages.invoiceStatuses.draft}</option>
                <option value="issued">{messages.invoiceStatuses.issued}</option>
              </select>
            </Field>
          </div>
          <Field
            label={messages.invoiceForm.contractLabel}
            htmlFor={CONTRACT_ID}
            {...(errors.contract ? { error: errors.contract } : {})}
          >
            <select
              id={CONTRACT_ID}
              className={selectClass}
              value={contractId}
              onChange={(event) => setContractId(event.target.value)}
              disabled={pending}
            >
              {contracts.map((contract) => (
                <option key={contract.id} value={contract.id}>
                  {contract.number}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={messages.invoiceForm.issuedLabel} htmlFor={ISSUED_ID}>
              <Input
                id={ISSUED_ID}
                type="date"
                value={issuedOn}
                onChange={(event) => setIssuedOn(event.target.value)}
                disabled={pending}
              />
            </Field>
            <Field
              label={messages.invoiceForm.dueLabel}
              htmlFor={DUE_ID}
              {...(errors.due ? { error: errors.due } : {})}
            >
              <Input
                id={DUE_ID}
                type="date"
                value={dueOn}
                onChange={(event) => setDueOn(event.target.value)}
                disabled={pending}
                aria-invalid={errors.due ? true : undefined}
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={messages.invoiceForm.amountLabel}
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
            <Field label={messages.invoiceForm.pdfLabel} htmlFor={PDF_ID}>
              <Input
                id={PDF_ID}
                value={pdfUrl}
                onChange={(event) => setPdfUrl(event.target.value)}
                disabled={pending}
                placeholder="https://"
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
              {pending ? messages.invoiceForm.pending : messages.invoiceForm.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
