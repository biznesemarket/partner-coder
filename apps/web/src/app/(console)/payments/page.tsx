import { EmptyState, PageHeader } from "@partner-coder/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ConsoleGuard } from "@/components/console/console-guard";
import { ServiceUnavailable } from "@/components/console/service-unavailable";
import { messages } from "@/lib/messages";
import { listVendorPayments } from "@/lib/vendor-finance-api";
import type { VendorPayment } from "@/lib/vendor-finance-types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: messages.payments.title,
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

function PaymentTable({ items }: { items: readonly VendorPayment[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">
              {messages.payments.dateLabel}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {messages.payments.customerLabel}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {messages.payments.invoiceLabel}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {messages.payments.amountLabel}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {messages.payments.methodLabel}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {messages.payments.referenceLabel}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {items.map((payment) => (
            <tr key={payment.id}>
              <td className="px-4 py-3 text-muted-foreground">{formatDate(payment.paidOn)}</td>
              <td className="px-4 py-3">
                <Link
                  className="underline-offset-4 hover:underline"
                  href={`/clients/${payment.customerId}`}
                >
                  {payment.customerLegalName}
                </Link>
              </td>
              <td className="px-4 py-3 font-mono text-xs">{payment.invoiceNumber}</td>
              <td className="px-4 py-3">{formatMoney(payment.amountKopecks)}</td>
              <td className="px-4 py-3">{messages.paymentMethods[payment.method]}</td>
              <td className="px-4 py-3 text-muted-foreground">{payment.reference ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function PaymentsView() {
  const payments = await listVendorPayments();

  if (payments.kind === "unauthenticated") {
    redirect("/login?returnTo=%2Fpayments");
  }
  if (payments.kind === "error") {
    return <ServiceUnavailable />;
  }

  return (
    <div className="grid gap-6">
      <PageHeader title={messages.payments.title} description={messages.payments.description} />
      {payments.items.length === 0 ? (
        <EmptyState
          title={messages.payments.emptyTitle}
          description={messages.payments.emptyDescription}
        />
      ) : (
        <PaymentTable items={payments.items} />
      )}
    </div>
  );
}

export default function PaymentsPage() {
  return <ConsoleGuard returnTo="/payments">{() => <PaymentsView />}</ConsoleGuard>;
}
