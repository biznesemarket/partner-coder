import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getVendorUserByEmail,
  getVendorUserById,
  vendorUsers,
  type Database,
  type VendorRole,
  type VendorUserStatus,
} from "@partner-coder/db";

import { createTestDatabase, type TestDatabase } from "../../../../packages/db/test/helpers.js";
import { MemoryMailer } from "../auth/mailer.js";
import { createVendorAuth, type VendorAuth } from "../vendor-auth/config.js";
import { provisionVendorAdmin, type ProvisionVendorAdminDeps } from "./provision-vendor-admin.js";

const authSecret = "vendor-test-secret-vendor-test-secret-1234";
const vendorBaseUrl = "http://localhost:3001";
const apiBaseUrl = "http://localhost:4000";

let database: TestDatabase;
let mailer: MemoryMailer;
let deps: ProvisionVendorAdminDeps;

function buildVendorAuth(db: Database, authMailer: MemoryMailer): VendorAuth {
  return createVendorAuth({
    db,
    secret: authSecret,
    baseURL: apiBaseUrl,
    vendorBaseURL: vendorBaseUrl,
    sessionTtlHours: 8,
    passwordResetTtlMinutes: 30,
    passwordMinLength: 12,
    webauthnRpId: "localhost",
    mailer: authMailer,
    rateLimitEnabled: false,
    getVendorStatus: async (vendorUserId) =>
      (await getVendorUserById(db, vendorUserId))?.status ?? null,
    getVendorStatusByEmail: async (email) =>
      (await getVendorUserByEmail(db, email))?.status ?? null,
    onSessionCreated: async () => {},
    onPasswordReset: async () => {},
  });
}

async function hasAudit(pool: TestDatabase["pool"], action: string): Promise<boolean> {
  const result = await pool.query("select 1 from vendor_audit_events where action = $1 limit 1", [
    action,
  ]);
  return result.rowCount === 1;
}

async function insertVendorUser(input: {
  readonly email: string;
  readonly role: VendorRole;
  readonly status: VendorUserStatus;
}): Promise<void> {
  await database.db.insert(vendorUsers).values({
    email: input.email,
    name: "Existing",
    role: input.role,
    status: input.status,
  });
}

beforeEach(async () => {
  database = await createTestDatabase();
  mailer = new MemoryMailer();
  deps = {
    db: database.db,
    authDb: database.db,
    auth: buildVendorAuth(database.db, mailer),
    mailer,
    vendorBaseUrl,
  };
}, 120_000);
afterEach(async () => {
  await database?.drop();
}, 60_000);

describe("provisionVendorAdmin", () => {
  it("создаёт первого superadmin и отправляет ссылку", async () => {
    const result = await provisionVendorAdmin(deps, {
      email: "ops@example.com",
      name: "Ops",
      force: false,
    });

    expect(result.invited).toBe(true);
    expect(await getVendorUserByEmail(database.db, "ops@example.com")).toMatchObject({
      role: "superadmin",
      status: "invited",
    });
    expect(mailer.vendorPasswordResets).toHaveLength(1);
    expect(mailer.vendorPasswordResets[0]?.email).toBe("ops@example.com");
    expect(new URL(mailer.vendorPasswordResets[0]!.url).pathname).toBe("/reset-password");
    expect(await hasAudit(database.pool, "vendor.user.bootstrap_admin")).toBe(true);
  });

  it("отказывается без --force, если superadmin уже есть", async () => {
    await provisionVendorAdmin(deps, { email: "ops@example.com", name: "Ops", force: false });

    await expect(
      provisionVendorAdmin(deps, { email: "second@example.com", name: "Second", force: false }),
    ).rejects.toThrow(/superadmin/);
  });

  it("отклоняет invited-пользователя с ролью не superadmin", async () => {
    await insertVendorUser({ email: "support@example.com", role: "support", status: "invited" });

    await expect(
      provisionVendorAdmin(deps, { email: "support@example.com", name: "Support", force: false }),
    ).rejects.toThrow(/ролью support; повысьте роль через PATCH \/v1\/vendor\/users\/:id/);
    expect(mailer.vendorPasswordResets).toHaveLength(0);
  });

  it("отклоняет active-пользователя даже с --force", async () => {
    await insertVendorUser({ email: "active@example.com", role: "support", status: "active" });

    await expect(
      provisionVendorAdmin(deps, { email: "active@example.com", name: "Active", force: true }),
    ).rejects.toThrow(/статусом active; измените статус через PATCH \/v1\/vendor\/users\/:id/);
    expect(mailer.vendorPasswordResets).toHaveLength(0);
  });

  it("с --force создаёт второго superadmin при наличии первого", async () => {
    await provisionVendorAdmin(deps, { email: "first@example.com", name: "First", force: false });

    const second = await provisionVendorAdmin(deps, {
      email: "second@example.com",
      name: "Second",
      force: true,
    });

    expect(second.invited).toBe(true);
    const superadmins = await database.pool.query<{ count: string }>(
      "select count(*)::text as count from vendor_users where role = 'superadmin'",
    );
    expect(superadmins.rows[0]?.count).toBe("2");
    expect(mailer.vendorPasswordResets).toHaveLength(2);
  });

  it("идемпотентен для invited superadmin", async () => {
    await provisionVendorAdmin(deps, { email: "ops@example.com", name: "Ops", force: false });

    const second = await provisionVendorAdmin(deps, {
      email: " OPS@Example.com ",
      name: "Ops",
      force: false,
    });

    expect(second.invited).toBe(true);
    const users = await database.pool.query<{ count: string }>(
      "select count(*)::text as count from vendor_users",
    );
    expect(users.rows[0]?.count).toBe("1");
    expect(mailer.vendorPasswordResets).toHaveLength(2);
  });
});
