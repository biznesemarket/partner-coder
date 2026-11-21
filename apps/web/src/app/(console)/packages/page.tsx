import { Badge, EmptyState, PageHeader } from "@partner-coder/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ConsoleGuard } from "@/components/console/console-guard";
import { ReissuePackageDialog } from "@/components/console/package-actions";
import { ServiceUnavailable } from "@/components/console/service-unavailable";
import { messages } from "@/lib/messages";
import { listVendorPackages } from "@/lib/vendor-finance-api";
import type { VendorProvisioningPackage } from "@/lib/vendor-finance-types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: messages.packages.title,
  robots: { index: false },
};

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("ru-RU");
}

function PackageTable({
  items,
  canReissue,
}: {
  items: readonly VendorProvisioningPackage[];
  canReissue: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[860px] text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">
              {messages.packages.customerLabel}
            </th>
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
          {items.map((pkg) => (
            <tr key={pkg.id}>
              <td className="px-4 py-3">
                <Link
                  className="underline-offset-4 hover:underline"
                  href={`/clients/${pkg.customerId}`}
                >
                  {pkg.customerLegalName}
                </Link>
              </td>
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

async function PackagesView({ canReissue }: { canReissue: boolean }) {
  const packages = await listVendorPackages();
  if (packages.kind === "unauthenticated") {
    redirect("/login?returnTo=%2Fpackages");
  }
  if (packages.kind === "error") {
    return <ServiceUnavailable />;
  }

  return (
    <div className="grid gap-6">
      <PageHeader title={messages.packages.title} description={messages.packages.description} />
      {packages.items.length === 0 ? (
        <EmptyState
          title={messages.packages.emptyTitle}
          description={messages.packages.emptyDescription}
        />
      ) : (
        <PackageTable items={packages.items} canReissue={canReissue} />
      )}
    </div>
  );
}

export default function PackagesPage() {
  return (
    <ConsoleGuard returnTo="/packages">
      {(me) => (
        <PackagesView canReissue={me.user.role === "superadmin" || me.user.role === "support"} />
      )}
    </ConsoleGuard>
  );
}
