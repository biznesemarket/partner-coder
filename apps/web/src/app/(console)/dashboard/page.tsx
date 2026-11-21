import { Card, CardContent, CardHeader, CardTitle, PageHeader } from "@partner-coder/ui";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ConsoleGuard } from "@/components/console/console-guard";
import { ServiceUnavailable } from "@/components/console/service-unavailable";
import { messages } from "@/lib/messages";
import { getVendorDashboard } from "@/lib/vendor-finance-api";
import type { VendorDashboard, VendorDashboardGroup } from "@/lib/vendor-finance-types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: messages.dashboard.title,
  robots: { index: false },
};

function FunnelCard({
  title,
  group,
  labels,
}: {
  title: string;
  group: VendorDashboardGroup | { total: number; byState: Record<string, number> };
  labels: Record<string, string>;
}) {
  const entries = Object.entries("byStatus" in group ? group.byStatus : group.byState);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-baseline justify-between gap-3 text-base">
          <span>{title}</span>
          <span className="text-2xl font-semibold tabular-nums">{group.total}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        {entries.map(([status, count]) => (
          <div className="flex items-center justify-between gap-3" key={status}>
            <span className="text-muted-foreground">{labels[status] ?? status}</span>
            <span className="tabular-nums">{count}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-1 text-3xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}

async function DashboardView() {
  const dashboard = await getVendorDashboard();
  if (dashboard.kind === "unauthenticated") {
    redirect("/login?returnTo=%2Fdashboard");
  }
  if (dashboard.kind === "error") {
    return <ServiceUnavailable />;
  }

  const data: VendorDashboard = dashboard.item;
  return (
    <div className="grid gap-6">
      <PageHeader title={messages.dashboard.title} description={messages.dashboard.description} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={messages.dashboard.activeCustomers}
          value={data.customers.byStatus.active ?? 0}
        />
        <StatCard
          label={messages.dashboard.activeSubscriptions}
          value={data.subscriptions.byStatus.active ?? 0}
        />
        <StatCard
          label={messages.dashboard.issuedPackages}
          value={data.packages.byStatus.issued ?? 0}
        />
        <StatCard
          label={messages.dashboard.activeOnboarding}
          value={data.onboarding.byState.active ?? 0}
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <FunnelCard
          title={messages.dashboard.customers}
          group={data.customers}
          labels={messages.customerStatuses}
        />
        <FunnelCard
          title={messages.dashboard.subscriptions}
          group={data.subscriptions}
          labels={messages.subscriptionStatuses}
        />
        <FunnelCard
          title={messages.dashboard.invoices}
          group={data.invoices}
          labels={messages.invoiceStatuses}
        />
        <FunnelCard
          title={messages.dashboard.packages}
          group={data.packages}
          labels={messages.packageStatuses}
        />
        <FunnelCard
          title={messages.dashboard.onboarding}
          group={data.onboarding}
          labels={messages.onboardingStates}
        />
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return <ConsoleGuard returnTo="/dashboard">{() => <DashboardView />}</ConsoleGuard>;
}
