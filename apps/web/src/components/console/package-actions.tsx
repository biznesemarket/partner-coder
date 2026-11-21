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
import { toast } from "sonner";

import { messages } from "@/lib/messages";
import {
  parseVendorProvisioningPackageIssue,
  type VendorProvisioningPackageIssue,
} from "@/lib/vendor-finance-types";

function PackageTokenResult({ result }: { result: VendorProvisioningPackageIssue }) {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(result.token);
      setCopied(true);
      toast.success(messages.packages.copied);
    } catch {
      toast.error(messages.errors.generic);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
        {messages.packages.tokenWarning}
      </div>
      <Field label={messages.packages.tokenTitle} htmlFor="package-token">
        <code
          id="package-token"
          className="block max-h-32 overflow-auto break-all rounded-md bg-muted p-3 text-xs"
        >
          {result.token}
        </code>
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => void copy()}>
          {messages.packages.copy}
        </Button>
        {copied ? <span className="self-center text-sm text-muted-foreground">OK</span> : null}
      </div>
    </div>
  );
}

export function IssuePackageDialog({ customerId }: { customerId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<VendorProvisioningPackageIssue | null>(null);

  async function issue(): Promise<void> {
    if (pending) return;
    setPending(true);
    try {
      const response = await fetch(
        `/v1/vendor/customers/${encodeURIComponent(customerId)}/packages`,
        { method: "POST" },
      );
      const body: unknown = await response.json().catch(() => null);
      const parsed = response.ok ? parseVendorProvisioningPackageIssue(body) : null;
      if (parsed) {
        setResult(parsed);
        toast.success(messages.packageForm.issued);
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
        if (!next) setResult(null);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button">{messages.packages.issue}</Button>
      </DialogTrigger>
      <DialogContent>
        <div className="grid gap-4">
          <DialogHeader>
            <DialogTitle>
              {result ? messages.packages.tokenTitle : messages.packageForm.issueTitle}
            </DialogTitle>
            <DialogDescription>
              {result ? messages.packageForm.issued : messages.packageForm.issueDescription}
            </DialogDescription>
          </DialogHeader>
          {result ? (
            <PackageTokenResult result={result} />
          ) : (
            <p className="text-sm text-muted-foreground">{messages.packageForm.issueDescription}</p>
          )}
          <DialogFooter>
            {result ? (
              <Button type="button" onClick={() => setOpen(false)}>
                {messages.packages.close}
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                  disabled={pending}
                >
                  {messages.common.cancel}
                </Button>
                <Button type="button" onClick={() => void issue()} disabled={pending}>
                  {pending ? <Spinner className="h-4 w-4" /> : null}
                  {pending ? messages.packageForm.pending : messages.packageForm.submitIssue}
                </Button>
              </>
            )}
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ReissuePackageDialog({ packageId, label }: { packageId: string; label?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<VendorProvisioningPackageIssue | null>(null);

  async function reissue(): Promise<void> {
    if (pending) return;
    setPending(true);
    try {
      const response = await fetch(`/v1/vendor/packages/${encodeURIComponent(packageId)}/reissue`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(reason.trim() === "" ? {} : { reason: reason.trim() }),
      });
      const body: unknown = await response.json().catch(() => null);
      const parsed = response.ok ? parseVendorProvisioningPackageIssue(body) : null;
      if (parsed) {
        setResult(parsed);
        toast.success(messages.packageForm.reissued);
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
        if (!next) {
          setResult(null);
          setReason("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          {label ?? messages.packages.reissue}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <div className="grid gap-4">
          <DialogHeader>
            <DialogTitle>
              {result ? messages.packages.tokenTitle : messages.packageForm.reissueTitle}
            </DialogTitle>
            <DialogDescription>
              {result ? messages.packageForm.reissued : messages.packageForm.reissueDescription}
            </DialogDescription>
          </DialogHeader>
          {result ? (
            <PackageTokenResult result={result} />
          ) : (
            <Field label={messages.packageForm.reasonLabel} htmlFor="reissue-reason">
              <Input
                id="reissue-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                disabled={pending}
                maxLength={500}
              />
            </Field>
          )}
          <DialogFooter>
            {result ? (
              <Button type="button" onClick={() => setOpen(false)}>
                {messages.packages.close}
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                  disabled={pending}
                >
                  {messages.common.cancel}
                </Button>
                <Button type="button" onClick={() => void reissue()} disabled={pending}>
                  {pending ? <Spinner className="h-4 w-4" /> : null}
                  {pending ? messages.packageForm.pending : messages.packageForm.submitReissue}
                </Button>
              </>
            )}
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
