import { sql } from "drizzle-orm";

import type { Database } from "../client.js";
import {
  customerStatus,
  invoiceStatus,
  onboardingState,
  provisioningPackageStatus,
  subscriptionStatus,
} from "../schema/enums.js";

export interface VendorDashboardCounts {
  readonly total: number;
  readonly byStatus: Record<string, number>;
}

export interface VendorDashboard {
  readonly customers: VendorDashboardCounts;
  readonly subscriptions: VendorDashboardCounts;
  readonly invoices: VendorDashboardCounts;
  readonly packages: VendorDashboardCounts;
  readonly onboarding: {
    readonly total: number;
    readonly byState: Record<string, number>;
  };
}

function emptyCounts(keys: readonly string[]): Record<string, number> {
  return Object.fromEntries(keys.map((key) => [key, 0]));
}

function mergeCounts(
  rows: readonly { key: string; count: number }[],
  keys: readonly string[],
): VendorDashboardCounts {
  const byStatus = emptyCounts(keys);
  let total = 0;
  for (const row of rows) {
    byStatus[row.key] = row.count;
    total += row.count;
  }
  return { total, byStatus };
}

async function groupCounts(
  db: Database,
  table: string,
  column: string,
): Promise<readonly { key: string; count: number }[]> {
  const result = await db.execute(
    sql.raw(`select ${column}::text as key, count(*)::int as count from ${table} group by 1`),
  );
  return result.rows as unknown as { key: string; count: number }[];
}

export async function getVendorDashboard(db: Database): Promise<VendorDashboard> {
  const customerRows = await groupCounts(db, "customers", "status");
  const subscriptionRows = await groupCounts(db, "subscriptions", "status");
  const invoiceRows = await groupCounts(db, "invoices", "status");
  const packageRows = await groupCounts(db, "provisioning_packages", "status");
  const onboardingRows = await groupCounts(db, "onboarding_sessions", "state");

  return {
    customers: mergeCounts(customerRows, customerStatus.enumValues),
    subscriptions: mergeCounts(subscriptionRows, subscriptionStatus.enumValues),
    invoices: mergeCounts(invoiceRows, invoiceStatus.enumValues),
    packages: mergeCounts(packageRows, provisioningPackageStatus.enumValues),
    onboarding: (() => {
      const byState = emptyCounts(onboardingState.enumValues);
      let total = 0;
      for (const row of onboardingRows) {
        byState[row.key] = row.count;
        total += row.count;
      }
      return { total, byState };
    })(),
  };
}
