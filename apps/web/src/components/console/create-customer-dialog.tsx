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

import { messages } from "@/lib/messages";
import { readVendorErrorCode } from "@/lib/vendor-finance-types";

const LEGAL_NAME_ID = "customer-legal-name";
const INN_ID = "customer-inn";
const KPP_ID = "customer-kpp";
const CONTACT_NAME_ID = "customer-contact-name";
const CONTACT_EMAIL_ID = "customer-contact-email";
const NOTES_ID = "customer-notes";

export function CreateCustomerDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [legalName, setLegalName] = useState("");
  const [inn, setInn] = useState("");
  const [kpp, setKpp] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  function reset(): void {
    setLegalName("");
    setInn("");
    setKpp("");
    setContactName("");
    setContactEmail("");
    setNotes("");
    setErrors({});
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending) {
      return;
    }

    const nextErrors: Record<string, string> = {};
    if (legalName.trim() === "") {
      nextErrors.legalName = messages.clients.legalNameRequired;
    }
    if (inn.trim() !== "" && !/^\d{10,12}$/.test(inn.trim())) {
      nextErrors.inn = messages.clients.innFormat;
    }
    if (kpp.trim() !== "" && !/^\d{9}$/.test(kpp.trim())) {
      nextErrors.kpp = messages.clients.kppFormat;
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setPending(true);
    setErrors({});
    try {
      const response = await fetch("/v1/vendor/customers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          legalName: legalName.trim(),
          ...(inn.trim() === "" ? {} : { inn: inn.trim() }),
          ...(kpp.trim() === "" ? {} : { kpp: kpp.trim() }),
          ...(contactName.trim() === "" && contactEmail.trim() === ""
            ? {}
            : {
                contact: {
                  ...(contactName.trim() === "" ? {} : { name: contactName.trim() }),
                  ...(contactEmail.trim() === "" ? {} : { email: contactEmail.trim() }),
                },
              }),
          ...(notes.trim() === "" ? {} : { notes: notes.trim() }),
        }),
      });
      const body: unknown = await response.json().catch(() => null);

      if (response.ok) {
        toast.success(messages.clients.created);
        reset();
        setOpen(false);
        router.refresh();
        return;
      }

      if (readVendorErrorCode(body) === "vendor_customer_inn_exists") {
        setErrors({ inn: messages.errors.customerInnExists });
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
        if (!next) {
          setErrors({});
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button">{messages.clients.create}</Button>
      </DialogTrigger>
      <DialogContent>
        <form className="grid gap-4" onSubmit={(event) => void handleSubmit(event)} noValidate>
          <DialogHeader>
            <DialogTitle>{messages.clients.createTitle}</DialogTitle>
            <DialogDescription>{messages.clients.createDescription}</DialogDescription>
          </DialogHeader>
          <Field
            label={messages.clients.legalNameLabel}
            htmlFor={LEGAL_NAME_ID}
            {...(errors.legalName ? { error: errors.legalName } : {})}
          >
            <Input
              id={LEGAL_NAME_ID}
              value={legalName}
              onChange={(event) => setLegalName(event.target.value)}
              disabled={pending}
              autoFocus
              aria-invalid={errors.legalName ? true : undefined}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={messages.clients.innLabel}
              htmlFor={INN_ID}
              {...(errors.inn ? { error: errors.inn } : {})}
            >
              <Input
                id={INN_ID}
                value={inn}
                onChange={(event) => setInn(event.target.value)}
                disabled={pending}
                inputMode="numeric"
                aria-invalid={errors.inn ? true : undefined}
              />
            </Field>
            <Field
              label={messages.clients.kppLabel}
              htmlFor={KPP_ID}
              {...(errors.kpp ? { error: errors.kpp } : {})}
            >
              <Input
                id={KPP_ID}
                value={kpp}
                onChange={(event) => setKpp(event.target.value)}
                disabled={pending}
                inputMode="numeric"
                aria-invalid={errors.kpp ? true : undefined}
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={messages.clients.contactNameLabel} htmlFor={CONTACT_NAME_ID}>
              <Input
                id={CONTACT_NAME_ID}
                value={contactName}
                onChange={(event) => setContactName(event.target.value)}
                disabled={pending}
                autoComplete="name"
              />
            </Field>
            <Field label={messages.clients.contactEmailLabel} htmlFor={CONTACT_EMAIL_ID}>
              <Input
                id={CONTACT_EMAIL_ID}
                type="email"
                value={contactEmail}
                onChange={(event) => setContactEmail(event.target.value)}
                disabled={pending}
                autoComplete="email"
              />
            </Field>
          </div>
          <Field label={messages.clients.notesLabel} htmlFor={NOTES_ID}>
            <Input
              id={NOTES_ID}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              disabled={pending}
            />
          </Field>
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
              {pending ? messages.clients.pending : messages.clients.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
