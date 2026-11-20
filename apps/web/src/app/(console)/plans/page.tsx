import { Badge, EmptyState, PageHeader } from "@partner-coder/ui";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ConsoleGuard } from "@/components/console/console-guard";
import { CreatePlanDialog } from "@/components/console/create-plan-dialog";
import { ServiceUnavailable } from "@/components/console/service-unavailable";
import { messages } from "@/lib/messages";
import { listVendorPlans } from "@/lib/vendor-finance-api";
import type { VendorPlan } from "@/lib/vendor-finance-types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: messages.plans.title,
  robots: { index: false },
};

const rubles = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});

function formatPrice(priceKopecks: string): string {
  return rubles.format(Number(priceKopecks) / 100);
}

function PlanTable({ items }: { items: readonly VendorPlan[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">
              {messages.plans.codeLabel}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {messages.plans.nameLabel}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {messages.plans.priceLabel}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {messages.plans.seatsLabel}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {messages.plans.projectsLabel}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Статус
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {items.map((plan) => (
            <tr key={plan.id} className="align-top">
              <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{plan.code}</td>
              <td className="px-4 py-3 font-medium">{plan.name}</td>
              <td className="px-4 py-3">
                {formatPrice(plan.priceKopecks)}
                <span className="text-muted-foreground">
                  {" "}
                  / {messages.planPeriods[plan.period]}
                </span>
              </td>
              <td className="px-4 py-3">{plan.seatsLimit}</td>
              <td className="px-4 py-3">{plan.projectsLimit}</td>
              <td className="px-4 py-3">
                <Badge variant={plan.isActive ? "secondary" : "outline"}>
                  {plan.isActive ? "Активен" : "Выключен"}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function PlansView({ canWrite }: { canWrite: boolean }) {
  const result = await listVendorPlans();

  if (result.kind === "unauthenticated") {
    redirect("/login?returnTo=%2Fplans");
  }
  if (result.kind === "error") {
    return <ServiceUnavailable />;
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title={messages.plans.title}
        description={messages.plans.description}
        actions={canWrite ? <CreatePlanDialog /> : undefined}
      />
      {result.items.length === 0 ? (
        <EmptyState
          title={messages.plans.emptyTitle}
          description={messages.plans.emptyDescription}
        />
      ) : (
        <PlanTable items={result.items} />
      )}
    </div>
  );
}

export default function PlansPage() {
  return (
    <ConsoleGuard returnTo="/plans">
      {(me) => <PlansView canWrite={me.user.role === "superadmin"} />}
    </ConsoleGuard>
  );
}
