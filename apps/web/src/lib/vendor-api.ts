import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";

import type { VendorMeResult } from "./vendor-types";
import { vendorMeResultFromResponse } from "./vendor-types";

const ME_PATH = "/v1/vendor/auth/me";

const TIMEOUT_MS = 5_000;

const VENDOR_COOKIE_PREFIX = "pc-vendor";

type MeResponse = {
  status: number;
  body: unknown;
};

function vendorCookieHeader(cookiesToForward: { name: string; value: string }[]): string {
  return cookiesToForward
    .filter(({ name }) => name.startsWith(VENDOR_COOKIE_PREFIX))
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ");
}

async function requestVendorMe(url: string, cookie: string): Promise<MeResponse | null> {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        cookie,
      },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const body: unknown = await response.json().catch(() => null);
    return { status: response.status, body };
  } catch {
    return null;
  }
}

export const getVendorMe = cache(async (): Promise<VendorMeResult> => {
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
  const response = await requestVendorMe(`${base}${ME_PATH}`, cookie);

  return response === null
    ? { kind: "error" }
    : vendorMeResultFromResponse(response.status, response.body);
});
