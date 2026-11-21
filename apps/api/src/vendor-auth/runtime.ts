import type { IncomingHttpHeaders } from "node:http";

import { fromNodeHeaders } from "better-auth/node";

import {
  vendorRole,
  vendorUserStatus,
  type Database,
  type VendorRole,
  type VendorUserStatus,
} from "@partner-coder/db";

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
  readonly packageTtlDays?: number;
  readonly packageVersion?: string;
}

export interface VendorAuthLogger {
  warn(fields: Record<string, unknown>, message: string): void;
}

interface VendorSession {
  readonly session: {
    readonly id: string;
    readonly expiresAt: Date | string | null | undefined;
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

function isVendorRole(value: unknown): value is VendorRole {
  return typeof value === "string" && (vendorRole.enumValues as readonly string[]).includes(value);
}

function isVendorStatus(value: unknown): value is VendorUserStatus {
  return (
    typeof value === "string" && (vendorUserStatus.enumValues as readonly string[]).includes(value)
  );
}

/**
 * Вендорская identity из отдельного Better Auth. Малейшая невалидность сессии
 * закрывает доступ: статус не фильтруется здесь (suspended/disabled вернутся
 * как есть и получат 403 в guard), но неизвестные роль/статус и битая дата
 * окончания сессии дают null.
 */
export async function resolveVendorIdentity(
  runtime: VendorAuthRuntime,
  headers: IncomingHttpHeaders,
  logger?: VendorAuthLogger,
): Promise<VendorIdentity | null> {
  const result = (await runtime.auth.api.getSession({
    headers: fromNodeHeaders(headers),
  })) as VendorSession | null;

  if (!result?.session || !result.user) {
    return null;
  }

  const role = result.user.role;
  if (!isVendorRole(role)) {
    logger?.warn(
      { sessionId: result.session.id, role: role ?? null },
      "vendor_session_invalid_role",
    );
    return null;
  }

  const status = result.user.status;
  if (!isVendorStatus(status)) {
    logger?.warn(
      { sessionId: result.session.id, status: status ?? null },
      "vendor_session_invalid_status",
    );
    return null;
  }

  const sessionExpiresAt = toDate(result.session.expiresAt);
  if (!sessionExpiresAt) {
    logger?.warn(
      { sessionId: result.session.id, expiresAt: result.session.expiresAt ?? null },
      "vendor_session_invalid_expiry",
    );
    return null;
  }

  return {
    userId: result.user.id,
    email: result.user.email,
    name: result.user.name,
    role,
    status,
    twoFactorEnabled: result.user.twoFactorEnabled === true,
    sessionId: result.session.id,
    sessionExpiresAt,
    stepUpUntil: toDate(result.session.stepUpUntil),
  };
}
