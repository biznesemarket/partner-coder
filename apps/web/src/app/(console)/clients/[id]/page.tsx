import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
} from "@partner-coder/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ConsoleGuard } from "@/components/console/console-guard";
import { CreateInvoiceDialog } from "@/components/console/create-invoice-dialog";
import { IssuePackageDialog, ReissuePackageDialog } from "@/components/console/package-actions";
import { RecordPaymentDialog } from "@/components/console/record-payment-dialog";
import { RenewSubscriptionDialog } from "@/components/console/renew-subscription-dialog";
import { ServiceUnavailable } from "@/components/console/service-unavailable";
import { messages } from "@/lib/messages";
import {
  getVendorCustomer,
  listVendorContracts,
  listVendorDiscounts,
  listVendorInvoices,
  listVendorPackages,
  listVendorPayments,
  listVendorPlans,
  listVendorSubscriptions,
} from "@/lib/vendor-finance-api";
import type {
  VendorContract,
  VendorDiscount,
  VendorInvoice,
  VendorPayment,
  VendorPlan,
  VendorProvisioningPackage,
  VendorSubscription,
} from "@/lib/vendor-finance-types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: messages.clientCard.title,
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

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("ru-RU");
}

function planName(plans: readonly VendorPlan[], planId: string): string {
  return plans.find((plan) => plan.id === planId)?.name ?? planId;
}

function ContractsTable({
  contracts,
  plans,
}: {
  contracts: readonly VendorContract[];
  plans: readonly VendorPlan[];
}) {
  if (contracts.length === 0) {
    return (
      <EmptyState
        title={messages.clientCard.noContracts}
        description="Договор создаётся до подписки и счёта."
      />
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">
              {messages.clientCard.contractNumber}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {messages.clientCard.plan}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {messages.clientCard.startsOn}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {messages.clientCard.endsOn}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Статус
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {contracts.map((contract) => (
            <tr key={contract.id}>
              <td className="px-4 py-3 font-mono text-xs">{contract.number}</td>
              <td className="px-4 py-3">{planName(plans, contract.planId)}</td>
              <td className="px-4 py-3 text-muted-foreground">{formatDate(contract.startsOn)}</td>
              <td className="px-4 py-3 text-muted-foreground">
                {contract.endsOn ? formatDate(contract.endsOn) : "—"}
              </td>
              <td className="px-4 py-3">
                <Badge variant="secondary">{messages.contractStatuses[contract.status]}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SubscriptionsTable({ subscriptions }: { subscriptions: readonly VendorSubscription[] }) {
  if (subscriptions.length === 0) {
    return (
      <EmptyState
        title={messages.clientCard.noSubscriptions}
        description="Подписка связывает договор, тариф и оплаченный период."
      />
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">
              {messages.clientCard.period}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {messages.clientCard.seats}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {messages.clientCard.projects}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Статус
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Изменён
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {subscriptions.map((subscription) => (
            <tr key={subscription.id}>
              <td className="px-4 py-3">
                {formatDate(subscription.periodStart)} — {formatDate(subscription.periodEnd)}
              </td>
              <td className="px-4 py-3">{subscription.seats}</td>
              <td className="px-4 py-3">{subscription.projectsLimit}</td>
              <td className="px-4 py-3">
                <Badge variant="secondary">
                  {messages.subscriptionStatuses[subscription.status]}
                </Badge>
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {formatDateTime(subscription.statusChangedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InvoicesTable({ invoices }: { invoices: readonly VendorInvoice[] }) {
  if (invoices.length === 0) {
    return (
      <EmptyState
        title={messages.clientCard.noInvoices}
        description="Счёт создаёт бухгалтерия после согласования периода."
      />
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">
              {messages.clientCard.invoiceNumber}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {messages.clientCard.issuedOn}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {messages.clientCard.dueOn}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {messages.clientCard.amount}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Статус
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {messages.clientCard.pdf}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {invoices.map((invoice) => (
            <tr key={invoice.id}>
              <td className="px-4 py-3 font-mono text-xs">{invoice.number}</td>
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

function PackagesTable({
  packages,
  canReissue,
}: {
  packages: readonly VendorProvisioningPackage[];
  canReissue: boolean;
}) {
  if (packages.length === 0) {
    return (
      <EmptyState
        title={messages.packages.emptyTitle}
        description={messages.packages.emptyDescription}
      />
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">
              {messages.packages.prefixLabel}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {messages.packages.versionLabel}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {messages.packages.statusLabel}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {messages.packages.expiresLabel}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {messages.packages.createdLabel}
            </th>
            {canReissue ? <th scope="col" className="px-4 py-3 font-medium" /> : null}
          </tr>
        </thead>
        <tbody className="divide-y">
          {packages.map((pkg) => (
            <tr key={pkg.id}>
              <td className="px-4 py-3 font-mono text-xs">{pkg.tokenPrefix}…</td>
              <td className="px-4 py-3">{pkg.version}</td>
              <td className="px-4 py-3">
                <Badge variant="secondary">{messages.packageStatuses[pkg.status]}</Badge>
              </td>
              <td className="px-4 py-3 text-muted-foreground">{formatDateTime(pkg.expiresAt)}</td>
              <td className="px-4 py-3 text-muted-foreground">{formatDateTime(pkg.createdAt)}</td>
              {canReissue ? (
                <td className="px-4 py-3 text-right">
                  <ReissuePackageDialog packageId={pkg.id} />
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PaymentsTable({ payments }: { payments: readonly VendorPayment[] }) {
  if (payments.length === 0) {
    return (
      <EmptyState
        title={messages.clientCard.noPayments}
        description="Платёж вносится по выставленному счёту."
      />
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">
              {messages.clientCard.paidOn}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {messages.clientCard.invoiceNumber}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {messages.clientCard.amount}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Способ
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {messages.clientCard.reference}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {payments.map((payment) => (
            <tr key={payment.id}>
              <td className="px-4 py-3 text-muted-foreground">{formatDate(payment.paidOn)}</td>
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

function activeDiscount(discounts: readonly VendorDiscount[]): VendorDiscount | null {
  const today = new Date().toISOString().slice(0, 10);
  return (
    discounts.find(
      (discount) =>
        discount.startsOn <= today && (discount.endsOn === null || discount.endsOn >= today),
    ) ?? null
  );
}

async function ClientView({
  customerId,
  role,
}: {
  customerId: string;
  role: "superadmin" | "finance" | "support" | "readonly";
}) {
  const canFinance = role === "finance";
  const canIssuePackage = role === "superadmin";
  const canReissuePackage = role === "superadmin" || role === "support";
  const customer = await getVendorCustomer(customerId);
  const contracts = await listVendorContracts(customerId);
  const subscriptions = await listVendorSubscriptions(customerId);
  const invoices = await listVendorInvoices(customerId);
  const payments = await listVendorPayments(customerId);
  const packages = await listVendorPackages(customerId);
  const plans = await listVendorPlans();

  if (
    customer.kind === "unauthenticated" ||
    contracts.kind === "unauthenticated" ||
    subscriptions.kind === "unauthenticated" ||
    invoices.kind === "unauthenticated" ||
    payments.kind === "unauthenticated" ||
    packages.kind === "unauthenticated" ||
    plans.kind === "unauthenticated"
  ) {
    redirect(`/login?returnTo=%2Fclients%2F${encodeURIComponent(customerId)}`);
  }
  if (
    customer.kind === "error" ||
    contracts.kind === "error" ||
    subscriptions.kind === "error" ||
    invoices.kind === "error" ||
    payments.kind === "error" ||
    packages.kind === "error" ||
    plans.kind === "error"
  ) {
    return <ServiceUnavailable />;
  }

  const currentSubscription = subscriptions.items[0];
  const discounts =
    currentSubscription === undefined
      ? { kind: "ok" as const, items: [] as readonly VendorDiscount[] }
      : await listVendorDiscounts(currentSubscription.id);
  const discount = discounts.kind === "ok" ? activeDiscount(discounts.items) : null;

  return (
    <div className="grid gap-6">
      <Link
        className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        href="/clients"
      >
        {messages.clientCard.back}
      </Link>
      <PageHeader
        title={customer.item.legalName}
        description={messages.clientCard.title}
        actions={
          canFinance || canIssuePackage ? (
            <div className="flex flex-wrap gap-2">
              {canFinance ? (
                <>
                  <CreateInvoiceDialog customerId={customer.item.id} contracts={contracts.items} />
                  <RecordPaymentDialog invoices={invoices.items} />
                  {currentSubscription !== undefined &&
                  currentSubscription.status !== "suspended" &&
                  currentSubscription.status !== "cancelled" ? (
                    <RenewSubscriptionDialog subscription={currentSubscription} />
                  ) : null}
                </>
              ) : null}
              {canIssuePackage ? <IssuePackageDialog customerId={customer.item.id} /> : null}
            </div>
          ) : undefined
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{messages.clientCard.requisites}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">{messages.clients.innLabel}</span>
              <span>{customer.item.inn ?? "—"}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">{messages.clients.kppLabel}</span>
              <span>{customer.item.kpp ?? "—"}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">{messages.clientCard.contact}</span>
              <span>{customer.item.contact.email ?? messages.clientCard.noContact}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Статус</span>
              <Badge variant="secondary">{messages.customerStatuses[customer.item.status]}</Badge>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{messages.clientCard.subscriptions}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {currentSubscription ? (
              <>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Статус</span>
                  <Badge variant="secondary">
                    {messages.subscriptionStatuses[currentSubscription.status]}
                  </Badge>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">{messages.clientCard.period}</span>
                  <span>
                    {formatDate(currentSubscription.periodStart)} —{" "}
                    {formatDate(currentSubscription.periodEnd)}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">{messages.clientCard.seats}</span>
                  <span>{currentSubscription.seats}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">{messages.clientCard.projects}</span>
                  <span>{currentSubscription.projectsLimit}</span>
                </div>
              </>
            ) : (
              <span className="text-muted-foreground">{messages.clientCard.noSubscriptions}</span>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{messages.clientCard.discount}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {discount ? (
              <>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Размер</span>
                  <span>{(discount.percentBp / 100).toLocaleString("ru-RU")}%</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">{messages.clientCard.period}</span>
                  <span>
                    {formatDate(discount.startsOn)} —{" "}
                    {discount.endsOn ? formatDate(discount.endsOn) : "бессрочно"}
                  </span>
                </div>
                {discount.note ? <p className="text-muted-foreground">{discount.note}</p> : null}
              </>
            ) : (
              <span className="text-muted-foreground">{messages.clientCard.noDiscount}</span>
            )}
          </CardContent>
        </Card>
      </div>

      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">{messages.clientCard.contracts}</h2>
        <ContractsTable contracts={contracts.items} plans={plans.items} />
      </section>
      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">{messages.clientCard.subscriptions}</h2>
        <SubscriptionsTable subscriptions={subscriptions.items} />
      </section>
      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">{messages.clientCard.invoices}</h2>
        <InvoicesTable invoices={invoices.items} />
      </section>
      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">{messages.clientCard.payments}</h2>
        <PaymentsTable payments={payments.items} />
      </section>
      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">{messages.packages.title}</h2>
        <PackagesTable packages={packages.items} canReissue={canReissuePackage} />
      </section>
    </div>
  );
}

export default async function ClientCardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <ConsoleGuard returnTo={`/clients/${id}`}>
      {(me) => <ClientView customerId={id} role={me.user.role} />}
    </ConsoleGuard>
  );
}
