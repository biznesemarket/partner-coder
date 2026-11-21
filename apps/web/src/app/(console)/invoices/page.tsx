import { Badge, EmptyState, PageHeader } from "@partner-coder/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ConsoleGuard } from "@/components/console/console-guard";
import { ServiceUnavailable } from "@/components/console/service-unavailable";
import { messages } from "@/lib/messages";
import { listVendorCustomers, listVendorInvoices } from "@/lib/vendor-finance-api";
import type { VendorInvoice } from "@/lib/vendor-finance-types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: messages.invoices.title,
  robots: { index: false },
};

const rubles = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 2,
});

function formatMoney(kopecks: string): string {
  return rubles.format(Number(kopecks) / 100);
}

function formatDate(value: string): string {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("ru-RU");
}

function InvoiceTable({
  items,
  customers,
}: {
  items: readonly VendorInvoice[];
  customers: Map<string, string>;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[840px] text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">
              {messages.invoices.numberLabel}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {messages.invoices.customerLabel}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {messages.invoices.issuedLabel}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {messages.invoices.dueLabel}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {messages.invoices.amountLabel}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {messages.invoices.statusLabel}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {messages.clientCard.pdf}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {items.map((invoice) => (
            <tr key={invoice.id}>
              <td className="px-4 py-3 font-mono text-xs">{invoice.number}</td>
              <td className="px-4 py-3">
                <Link
                  className="underline-offset-4 hover:underline"
                  href={`/clients/${invoice.customerId}`}
                >
                  {customers.get(invoice.customerId) ?? invoice.customerId}
                </Link>
              </td>
              <td className="px-4 py-3 text-muted-foreground">{formatDate(invoice.issuedOn)}</td>
              <td className="px-4 py-3 text-muted-foreground">{formatDate(invoice.dueOn)}</td>
              <td className="px-4 py-3">{formatMoney(invoice.amountKopecks)}</td>
              <td className="px-4 py-3">
                <Badge variant="secondary">{messages.invoiceStatuses[invoice.status]}</Badge>
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {invoice.pdfUrl ? (
                  <a className="underline-offset-4 hover:underline" href={invoice.pdfUrl}>
                    {messages.clientCard.pdf}
                  </a>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function InvoicesView() {
  const invoices = await listVendorInvoices();
  const customers = await listVendorCustomers();

  if (invoices.kind === "unauthenticated" || customers.kind === "unauthenticated") {
    redirect("/login?returnTo=%2Finvoices");
  }
  if (invoices.kind === "error" || customers.kind === "error") {
    return <ServiceUnavailable />;
  }

  const names = new Map(customers.items.map((customer) => [customer.id, customer.legalName]));

  return (
    <div className="grid gap-6">
      <PageHeader title={messages.invoices.title} description={messages.invoices.description} />
      {invoices.items.length === 0 ? (
        <EmptyState
          title={messages.invoices.emptyTitle}
          description={messages.invoices.emptyDescription}
        />
      ) : (
        <InvoiceTable items={invoices.items} customers={names} />
      )}
    </div>
  );
}

export default function InvoicesPage() {
  return <ConsoleGuard returnTo="/invoices">{() => <InvoicesView />}</ConsoleGuard>;
}
