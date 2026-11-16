import { eq, sql } from "drizzle-orm";

import type { Database } from "../client.js";
import { vendorUsers } from "../schema/vendor.js";
import { writeVendorAudit } from "./audit.js";

export interface ResetVendorMfaInput {
  readonly actorId: string;
  readonly ip?: string | null;
}

export interface ResetVendorMfaResult {
  readonly twoFactors: number;
  readonly passkeys: number;
  readonly sessions: number;
}

export async function revokeVendorSessions(db: Database, vendorUserId: string): Promise<number> {
  const result = await db.execute(
    sql`delete from vendor_auth_sessions where user_id = ${vendorUserId}`,
  );
  return result.rowCount ?? 0;
}

/**
 * Полный сброс MFA: TOTP, passkeys, сессии и флаг two_factor_enabled. Всё в
 * одной транзакции вместе с аудитом, чтобы не оставить частичное состояние.
 */
export async function resetVendorMfa(
  db: Database,
  vendorUserId: string,
  input: ResetVendorMfaInput,
): Promise<ResetVendorMfaResult> {
  return db.transaction(async (tx) => {
    const twoFactors = await tx.execute(
      sql`delete from vendor_auth_two_factors where user_id = ${vendorUserId}`,
    );
    const passkeys = await tx.execute(
      sql`delete from vendor_auth_passkeys where user_id = ${vendorUserId}`,
    );
    const sessions = await tx.execute(
      sql`delete from vendor_auth_sessions where user_id = ${vendorUserId}`,
    );

    await tx
      .update(vendorUsers)
      .set({ twoFactorEnabled: false, updatedAt: new Date() })
      .where(eq(vendorUsers.id, vendorUserId));

    const result = {
      twoFactors: twoFactors.rowCount ?? 0,
      passkeys: passkeys.rowCount ?? 0,
      sessions: sessions.rowCount ?? 0,
    };

    await writeVendorAudit(tx, {
      actorId: input.actorId,
      action: "vendor.user.mfa_reset",
      entity: "vendor_user",
      after: { userId: vendorUserId, ...result },
      ip: input.ip ?? null,
    });

    return result;
  });
}
