import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";

import {
  parseVendorCustomerList,
  parseVendorPlanList,
  type VendorCustomer,
  type VendorListResult,
  type VendorPlan,
} from "./vendor-finance-types";
import { vendorCookieHeader } from "./vendor-api";

const TIMEOUT_MS = 5_000;

async function requestList<T>(
  path: string,
  parse: (value: unknown) => readonly T[] | null,
): Promise<VendorListResult<T>> {
  const apiBaseUrl = process.env.API_BASE_URL;
  if (!apiBaseUrl) {
    return { kind: "error" };
  }

  const cookieStore = await cookies();
  const cookie = vendorCookieHeader(cookieStore.getAll());
  if (cookie === "") {
    return { kind: "unauthenticated" };
  }

  const base = apiBaseUrl.replace(/\/+$/, "");
  try {
    const response = await fetch(`${base}${path}`, {
      method: "GET",
      headers: { accept: "application/json", cookie },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status === 401) {
      return { kind: "unauthenticated" };
    }
    if (response.status !== 200) {
      return { kind: "error" };
    }
    const body: unknown = await response.json().catch(() => null);
    const items = parse(body);
    return items === null ? { kind: "error" } : { kind: "ok", items };
  } catch {
    return { kind: "error" };
  }
}

export const listVendorCustomers = cache(async (): Promise<VendorListResult<VendorCustomer>> =>
  requestList("/v1/vendor/customers", parseVendorCustomerList),
);

export const listVendorPlans = cache(async (): Promise<VendorListResult<VendorPlan>> =>
  requestList("/v1/vendor/plans", parseVendorPlanList),
);
