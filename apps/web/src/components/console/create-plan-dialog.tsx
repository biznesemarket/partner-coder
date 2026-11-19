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
import { readVendorErrorCode, type VendorPlanPeriod } from "@/lib/vendor-finance-types";

const CODE_ID = "plan-code";
const NAME_ID = "plan-name";
const PRICE_ID = "plan-price";
const PERIOD_ID = "plan-period";
const SEATS_ID = "plan-seats";
const PROJECTS_ID = "plan-projects";

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

export function CreatePlanDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [priceRubles, setPriceRubles] = useState("");
  const [period, setPeriod] = useState<VendorPlanPeriod>("month");
  const [seats, setSeats] = useState("3");
  const [projects, setProjects] = useState("1");
  const [errors, setErrors] = useState<Record<string, string>>({});

  function reset(): void {
    setCode("");
    setName("");
    setPriceRubles("");
    setPeriod("month");
    setSeats("3");
    setProjects("1");
    setErrors({});
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending) {
      return;
    }

    const nextErrors: Record<string, string> = {};
    if (!/^[a-z0-9][a-z0-9_-]{1,31}$/.test(code.trim())) {
      nextErrors.code = messages.plans.codeFormat;
    }
    if (name.trim() === "") {
      nextErrors.name = messages.plans.nameRequired;
    }
    if (!/^\d+$/.test(priceRubles.trim())) {
      nextErrors.price = messages.plans.priceFormat;
    }
    const seatsNumber = Number(seats);
    if (!Number.isInteger(seatsNumber) || seatsNumber < 1 || seatsNumber > 1000) {
      nextErrors.seats = messages.plans.seatsFormat;
    }
    const projectsNumber = Number(projects);
    if (!Number.isInteger(projectsNumber) || projectsNumber < 1 || projectsNumber > 1000) {
      nextErrors.projects = messages.plans.projectsFormat;
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    const priceKopecks = Math.round(Number(priceRubles.trim()) * 100);
    if (!Number.isSafeInteger(priceKopecks)) {
      setErrors({ price: messages.plans.priceFormat });
      return;
    }

    setPending(true);
    setErrors({});
    try {
      const response = await fetch("/v1/vendor/plans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: code.trim(),
          name: name.trim(),
          priceKopecks: priceKopecks.toString(),
          period,
          seatsLimit: seatsNumber,
          projectsLimit: projectsNumber,
        }),
      });
      const body: unknown = await response.json().catch(() => null);

      if (response.ok) {
        toast.success(messages.plans.created);
        reset();
        setOpen(false);
        router.refresh();
        return;
      }

      if (readVendorErrorCode(body) === "vendor_plan_code_exists") {
        setErrors({ code: messages.errors.planCodeExists });
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
        <Button type="button">{messages.plans.create}</Button>
      </DialogTrigger>
      <DialogContent>
        <form className="grid gap-4" onSubmit={(event) => void handleSubmit(event)} noValidate>
          <DialogHeader>
            <DialogTitle>{messages.plans.createTitle}</DialogTitle>
            <DialogDescription>{messages.plans.createDescription}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={messages.plans.codeLabel}
              htmlFor={CODE_ID}
              {...(errors.code ? { error: errors.code } : {})}
            >
              <Input
                id={CODE_ID}
                value={code}
                onChange={(event) => setCode(event.target.value)}
                disabled={pending}
                autoFocus
                aria-invalid={errors.code ? true : undefined}
              />
            </Field>
            <Field
              label={messages.plans.nameLabel}
              htmlFor={NAME_ID}
              {...(errors.name ? { error: errors.name } : {})}
            >
              <Input
                id={NAME_ID}
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={pending}
                aria-invalid={errors.name ? true : undefined}
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={messages.plans.priceLabel}
              htmlFor={PRICE_ID}
              {...(errors.price ? { error: errors.price } : {})}
            >
              <Input
                id={PRICE_ID}
                value={priceRubles}
                onChange={(event) => setPriceRubles(event.target.value)}
                disabled={pending}
                inputMode="numeric"
                aria-invalid={errors.price ? true : undefined}
              />
            </Field>
            <Field label={messages.plans.periodLabel} htmlFor={PERIOD_ID}>
              <select
                id={PERIOD_ID}
                className={selectClass}
                value={period}
                onChange={(event) => setPeriod(event.target.value as VendorPlanPeriod)}
                disabled={pending}
              >
                <option value="month">{messages.planPeriods.month}</option>
                <option value="quarter">{messages.planPeriods.quarter}</option>
                <option value="year">{messages.planPeriods.year}</option>
              </select>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={messages.plans.seatsLabel}
              htmlFor={SEATS_ID}
              {...(errors.seats ? { error: errors.seats } : {})}
            >
              <Input
                id={SEATS_ID}
                value={seats}
                onChange={(event) => setSeats(event.target.value)}
                disabled={pending}
                inputMode="numeric"
                aria-invalid={errors.seats ? true : undefined}
              />
            </Field>
            <Field
              label={messages.plans.projectsLabel}
              htmlFor={PROJECTS_ID}
              {...(errors.projects ? { error: errors.projects } : {})}
            >
              <Input
                id={PROJECTS_ID}
                value={projects}
                onChange={(event) => setProjects(event.target.value)}
                disabled={pending}
                inputMode="numeric"
                aria-invalid={errors.projects ? true : undefined}
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
              {pending ? messages.plans.pending : messages.plans.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
