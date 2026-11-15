import { sql } from "drizzle-orm";

import type { Database } from "../client.js";
import type { MembershipRole, MembershipStatus, TenantStatus } from "./errors.js";

export interface UserMembership {
  readonly membershipId: string;
  readonly tenantId: string;
  readonly role: MembershipRole;
  readonly status: MembershipStatus;
  readonly tenantName: string;
  readonly tenantSlug: string;
  readonly tenantTimezone: string;
  readonly tenantStatus: TenantStatus;
  readonly joinedAt: Date | null;
}

export async function listUserMemberships(
  db: Database,
  userId: string,
): Promise<readonly UserMembership[]> {
  const result = await db.execute(
    sql`select membership_id, tenant_id, role, status, tenant_name, tenant_slug,
               tenant_timezone, tenant_status, joined_at
          from auth_user_memberships(${userId})`,
  );
  return result.rows.map((raw) => {
    const row = raw as {
      membership_id: string;
      tenant_id: string;
      role: MembershipRole;
      status: MembershipStatus;
      tenant_name: string;
      tenant_slug: string;
      tenant_timezone: string;
      tenant_status: TenantStatus;
      joined_at: Date | string | null;
    };
    return {
      membershipId: row.membership_id,
      tenantId: row.tenant_id,
      role: row.role,
      status: row.status,
      tenantName: row.tenant_name,
      tenantSlug: row.tenant_slug,
      tenantTimezone: row.tenant_timezone,
      tenantStatus: row.tenant_status,
      joinedAt: row.joined_at ? new Date(row.joined_at) : null,
    };
  });
}

export async function findUserByEmail(
  db: Database,
  email: string,
): Promise<{ id: string; email: string; name: string; status: string } | null> {
  const result = await db.execute(
    sql`select id, email, name, status from auth_user_by_email(${email})`,
  );
  const row = result.rows[0] as
    { id: string; email: string; name: string; status: string } | undefined;
  return row ?? null;
}
