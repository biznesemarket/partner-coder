"use client";

import type { VendorMeResult } from "./vendor-types";
import { vendorMeResultFromResponse } from "./vendor-types";

const ME_PATH = "/v1/vendor/auth/me";

const TIMEOUT_MS = 5_000;

export async function fetchVendorMe(): Promise<VendorMeResult> {
  try {
    const response = await fetch(ME_PATH, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const body: unknown = await response.json().catch(() => null);
    return vendorMeResultFromResponse(response.status, body);
  } catch {
    return { kind: "error" };
  }
}
