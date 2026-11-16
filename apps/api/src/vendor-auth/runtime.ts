import type { IncomingHttpHeaders } from "node:http";

import { fromNodeHeaders } from "better-auth/node";

import type { Database, VendorRole, VendorUserStatus } from "@partner-coder/db";

import type { VendorAuth } from "./config.js";

export interface VendorIdentity {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly role: VendorRole;
  readonly status: VendorUserStatus;
  readonly twoFactorEnabled: boolean;
  readonly sessionId: string;
  readonly sessionExpiresAt: Date;
  readonly stepUpUntil: Date | null;
}

export interface VendorAuthRuntime {
  readonly auth: VendorAuth;
  readonly db: Database;
  readonly authDb: Database;
  readonly vendorBaseUrl: string;
  readonly stepUpMinutes: number;
}

interface VendorSession {
  readonly session: {
    readonly id: string;
    readonly expiresAt: Date;
    readonly stepUpUntil?: Date | string | null;
  };
  readonly user: {
    readonly id: string;
    readonly email: string;
    readonly name: string;
    readonly role?: string | null;
    readonly status?: string | null;
    readonly twoFactorEnabled?: boolean | null;
  };
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Вендорская identity из отдельного Better Auth. Статус не фильтруется здесь:
 * suspended/disabled возвращаются как есть, решение принимает guard.
 */
export async function resolveVendorIdentity(
  runtime: VendorAuthRuntime,
  headers: IncomingHttpHeaders,
): Promise<VendorIdentity | null> {
  const result = (await runtime.auth.api.getSession({
    headers: fromNodeHeaders(headers),
  })) as VendorSession | null;

  if (!result?.session || !result.user) {
    return null;
  }

  return {
    userId: result.user.id,
    email: result.user.email,
    name: result.user.name,
    role: (result.user.role ?? "support") as VendorRole,
    status: (result.user.status ?? "invited") as VendorUserStatus,
    twoFactorEnabled: result.user.twoFactorEnabled === true,
    sessionId: result.session.id,
    sessionExpiresAt: result.session.expiresAt,
    stepUpUntil: toDate(result.session.stepUpUntil),
  };
}
