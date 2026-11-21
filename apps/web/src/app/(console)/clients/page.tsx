import { Badge, EmptyState, PageHeader } from "@partner-coder/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ConsoleGuard } from "@/components/console/console-guard";
import { CreateCustomerDialog } from "@/components/console/create-customer-dialog";
import { ServiceUnavailable } from "@/components/console/service-unavailable";
import { messages } from "@/lib/messages";
import { listVendorCustomers } from "@/lib/vendor-finance-api";
import type { VendorCustomer } from "@/lib/vendor-finance-types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: messages.clients.title,
  robots: { index: false },
};

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("ru-RU");
}

function CustomerTable({ items }: { items: readonly VendorCustomer[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">
              {messages.clients.legalNameLabel}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {messages.clients.innLabel}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {messages.clients.contactEmailLabel}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Статус
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Создан
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {items.map((customer) => (
            <tr key={customer.id} className="align-top">
              <td className="px-4 py-3 font-medium">
                <Link
                  className="underline-offset-4 hover:underline"
                  href={`/clients/${customer.id}`}
                >
                  {customer.legalName}
                </Link>
              </td>
              <td className="px-4 py-3 text-muted-foreground">{customer.inn ?? "—"}</td>
              <td className="px-4 py-3 text-muted-foreground">{customer.contact.email ?? "—"}</td>
              <td className="px-4 py-3">
                <Badge variant="secondary">{messages.customerStatuses[customer.status]}</Badge>
              </td>
              <td className="px-4 py-3 text-muted-foreground">{formatDate(customer.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function ClientsView({ canWrite }: { canWrite: boolean }) {
  const result = await listVendorCustomers();

  if (result.kind === "unauthenticated") {
    redirect("/login?returnTo=%2Fclients");
  }
  if (result.kind === "error") {
    return <ServiceUnavailable />;
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title={messages.clients.title}
        description={messages.clients.description}
        actions={canWrite ? <CreateCustomerDialog /> : undefined}
      />
      {result.items.length === 0 ? (
        <EmptyState
          title={messages.clients.emptyTitle}
          description={messages.clients.emptyDescription}
        />
      ) : (
        <CustomerTable items={result.items} />
      )}
    </div>
  );
}

export default function ClientsPage() {
  return (
    <ConsoleGuard returnTo="/clients">
      {(me) => <ClientsView canWrite={me.user.role === "superadmin"} />}
    </ConsoleGuard>
  );
}
