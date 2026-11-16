import { asc, eq, sql } from "drizzle-orm";

import type { Database } from "../client.js";
import { vendorUsers } from "../schema/vendor.js";
import type { VendorRole, VendorUser, VendorUserStatus } from "./types.js";

export interface UpdateVendorUserInput {
  readonly role?: VendorRole;
  readonly status?: VendorUserStatus;
}

export async function getVendorUserById(
  db: Database,
  vendorUserId: string,
): Promise<VendorUser | null> {
  const [user] = await db
    .select()
    .from(vendorUsers)
    .where(eq(vendorUsers.id, vendorUserId))
    .limit(1);
  return user ?? null;
}

export async function getVendorUserByEmail(
  db: Database,
  email: string,
): Promise<VendorUser | null> {
  const [user] = await db
    .select()
    .from(vendorUsers)
    .where(sql`lower(${vendorUsers.email}) = ${email.trim().toLowerCase()}`)
    .limit(1);
  return user ?? null;
}

export async function listVendorUsers(db: Database): Promise<readonly VendorUser[]> {
  return db.select().from(vendorUsers).orderBy(asc(vendorUsers.createdAt), asc(vendorUsers.id));
}

export async function updateVendorUser(
  db: Database,
  vendorUserId: string,
  input: UpdateVendorUserInput,
): Promise<VendorUser | null> {
  const patch: { role?: VendorRole; status?: VendorUserStatus; updatedAt?: Date } = {};
  if (input.role !== undefined) {
    patch.role = input.role;
  }
  if (input.status !== undefined) {
    patch.status = input.status;
  }
  if (patch.role === undefined && patch.status === undefined) {
    return getVendorUserById(db, vendorUserId);
  }
  patch.updatedAt = new Date();

  const [user] = await db
    .update(vendorUsers)
    .set(patch)
    .where(eq(vendorUsers.id, vendorUserId))
    .returning();
  return user ?? null;
}

/** Отмечает вход и активирует только приглашённого пользователя. */
export async function markVendorLogin(db: Database, vendorUserId: string): Promise<void> {
  await db.execute(sql`
    update vendor_users
       set last_login_at = now(),
           updated_at = now(),
           status = case
             when status = 'invited' then 'active'::vendor_user_status
             else status
           end
     where id = ${vendorUserId}
  `);
}

/**
 * Подтверждает email после сброса пароля. suspended/disabled остаются как есть:
 * вход в консоль по-прежнему запрещён.
 */
export async function activateAfterPasswordReset(
  db: Database,
  vendorUserId: string,
): Promise<VendorUser> {
  const [user] = await db
    .update(vendorUsers)
    .set({
      emailVerified: true,
      updatedAt: new Date(),
      status: sql`
        case
          when ${vendorUsers.status} = 'invited' then 'active'::vendor_user_status
          else ${vendorUsers.status}
        end
      `,
    })
    .where(eq(vendorUsers.id, vendorUserId))
    .returning();
  if (!user) {
    throw new Error(`Vendor user ${vendorUserId} not found`);
  }
  return user;
}
