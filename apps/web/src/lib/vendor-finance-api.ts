import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";

import {
  parseVendorContractList,
  parseVendorCustomerList,
  parseVendorCustomerOne,
  parseVendorDiscountList,
  parseVendorInvoiceList,
  parseVendorPaymentList,
  parseVendorPlanList,
  parseVendorSubscriptionList,
  type VendorContract,
  type VendorCustomer,
  type VendorDiscount,
  type VendorInvoice,
  type VendorListResult,
  type VendorPayment,
  type VendorPlan,
  type VendorSubscription,
} from "./vendor-finance-types";
import { vendorCookieHeader } from "./vendor-api";

const TIMEOUT_MS = 10_000;

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

export const listVendorContracts = cache(
  async (customerId?: string): Promise<VendorListResult<VendorContract>> =>
    requestList(
      customerId === undefined
        ? "/v1/vendor/contracts"
        : `/v1/vendor/contracts?customerId=${encodeURIComponent(customerId)}`,
      parseVendorContractList,
    ),
);

export const listVendorSubscriptions = cache(
  async (customerId?: string): Promise<VendorListResult<VendorSubscription>> =>
    requestList(
      customerId === undefined
        ? "/v1/vendor/subscriptions"
        : `/v1/vendor/subscriptions?customerId=${encodeURIComponent(customerId)}`,
      parseVendorSubscriptionList,
    ),
);

export const listVendorInvoices = cache(
  async (customerId?: string): Promise<VendorListResult<VendorInvoice>> =>
    requestList(
      customerId === undefined
        ? "/v1/vendor/invoices"
        : `/v1/vendor/invoices?customerId=${encodeURIComponent(customerId)}`,
      parseVendorInvoiceList,
    ),
);

export const listVendorPayments = cache(
  async (customerId?: string): Promise<VendorListResult<VendorPayment>> =>
    requestList(
      customerId === undefined
        ? "/v1/vendor/payments"
        : `/v1/vendor/payments?customerId=${encodeURIComponent(customerId)}`,
      parseVendorPaymentList,
    ),
);

export const listVendorDiscounts = cache(
  async (subscriptionId: string): Promise<VendorListResult<VendorDiscount>> =>
    requestList(
      `/v1/vendor/subscriptions/${encodeURIComponent(subscriptionId)}/discounts`,
      parseVendorDiscountList,
    ),
);

export type VendorItemResult<T> =
  { kind: "ok"; item: T } | { kind: "unauthenticated" } | { kind: "error" };

async function requestItem<T>(
  path: string,
  parse: (value: unknown) => T | null,
): Promise<VendorItemResult<T>> {
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
    const item = parse(body);
    return item === null ? { kind: "error" } : { kind: "ok", item };
  } catch {
    return { kind: "error" };
  }
}

export const getVendorCustomer = cache(
  async (customerId: string): Promise<VendorItemResult<VendorCustomer>> =>
    requestItem(`/v1/vendor/customers/${encodeURIComponent(customerId)}`, parseVendorCustomerOne),
);
