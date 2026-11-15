import { sql } from "drizzle-orm";

import type { Database } from "@partner-coder/db";

export interface TtlCleanupOptions {
  readonly sessionRetentionDays: number;
  readonly verificationRetentionDays: number;
  readonly heartbeatRetentionDays: number;
}

export interface TtlCleanupResult {
  readonly idempotencyKeys: number;
  readonly authVerifications: number;
  readonly authRateLimits: number;
  readonly emailRateLimits: number;
  readonly authSessionsExpired: number;
  readonly authSessionsSuspendedUser: number;
  readonly activeTenantsCleared: number;
  readonly deviceTokensExpired: number;
  readonly deviceTokensSuspended: number;
  readonly heartbeats: number;
}

function affected(rowCount: number | null | undefined): number {
  return rowCount ?? 0;
}

/**
 * Периодическая уборка auth-контура и сырых heartbeat.
 *
 * - истекшие ключи идемпотентности;
 * - просроченные OTP/magic-link проверки и сессии (с запасом на аудит);
 * - сессии suspended/deleted пользователей и активный tenant suspended/archived;
 * - device-токены истекшие или принадлежащие suspended tenant/пользователю;
 * - heartbeat старше retention через отдельную retention-роль.
 */
export async function runTtlCleanup(
  db: Database,
  options: TtlCleanupOptions,
): Promise<TtlCleanupResult> {
  const idempotency = await db.execute(sql`
    delete from idempotency_keys where expires_at < now()
  `);

  const verifications = await db.execute(sql`
    delete from auth_verifications
     where expires_at < now() - make_interval(days => ${options.verificationRetentionDays})
  `);

  // Окна rate limit короткие (минуты); сутки — запас для нескольких инстансов
  // и ручной диагностики. Счетчики не являются аудитными данными.
  const authRateLimits = await db.execute(sql`
    delete from auth_rate_limits
     where last_request < floor(extract(epoch from now() - interval '1 day') * 1000)::bigint
  `);

  const emailRateLimits = await db.execute(sql`
    delete from email_rate_limits
     where window_started_at < now() - interval '1 day'
  `);

  const expiredSessions = await db.execute(sql`
    delete from auth_sessions
     where expires_at < now() - make_interval(days => ${options.sessionRetentionDays})
  `);

  const suspendedUserSessions = await db.execute(sql`
    delete from auth_sessions s
     using users u
     where s.user_id = u.id
       and u.status in ('suspended', 'deleted')
  `);

  const clearedTenants = await db.execute(sql`
    update auth_sessions s
       set active_tenant_id = null,
           updated_at = now()
      from tenants t
     where s.active_tenant_id = t.id
       and t.status in ('suspended', 'archived')
  `);

  const expiredDevices = await db.execute(sql`
    update device_tokens
       set revoked_at = now(),
           updated_at = now()
     where expires_at is not null
       and expires_at < now()
       and revoked_at is null
  `);

  const suspendedDevices = await db.execute(sql`
    update device_tokens dt
       set revoked_at = now(),
           updated_at = now()
      from memberships m, users u, tenants t
     where dt.membership_id = m.id
       and dt.tenant_id = m.tenant_id
       and u.id = m.user_id
       and t.id = dt.tenant_id
       and dt.revoked_at is null
       and (u.status in ('suspended', 'deleted') or t.status in ('suspended', 'archived'))
  `);

  const heartbeats = await db.execute(sql`
    select retention_delete_heartbeats(
      now() - make_interval(days => ${options.heartbeatRetentionDays})
    ) as deleted
  `);
  const deletedHeartbeats = Number(
    (heartbeats.rows[0] as { deleted?: string | number } | undefined)?.deleted ?? 0,
  );

  return {
    idempotencyKeys: affected(idempotency.rowCount),
    authVerifications: affected(verifications.rowCount),
    authRateLimits: affected(authRateLimits.rowCount),
    emailRateLimits: affected(emailRateLimits.rowCount),
    authSessionsExpired: affected(expiredSessions.rowCount),
    authSessionsSuspendedUser: affected(suspendedUserSessions.rowCount),
    activeTenantsCleared: affected(clearedTenants.rowCount),
    deviceTokensExpired: affected(expiredDevices.rowCount),
    deviceTokensSuspended: affected(suspendedDevices.rowCount),
    heartbeats: deletedHeartbeats,
  };
}
