import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "../src/index.js";
import { LastSuperadminError, updateVendorUserGuarded } from "../src/vendor-auth/index.js";
import { createTestDatabase, type TestDatabase } from "./helpers.js";
import { seedVendorBase } from "./fixtures.js";

let database: TestDatabase;
let db: Database;
let firstAdminId: string;
let secondAdminId: string;

beforeAll(async () => {
  database = await createTestDatabase();
  db = createDatabase(database.pool);
  const base = await seedVendorBase(database.pool);
  firstAdminId = base.vendorUserId;
  secondAdminId = randomUUID();
  await database.pool.query(
    `insert into vendor_users (id, email, name, role, status)
     values ($1, $2, 'Второй', 'superadmin', 'active')`,
    [secondAdminId, `second-${secondAdminId}@example.com`],
  );
}, 120_000);

afterAll(async () => {
  await database?.drop();
}, 60_000);

async function activeSuperadmins(): Promise<number> {
  const result = await database.pool.query<{ count: string }>(
    `select count(*)::text as count
       from vendor_users
      where role = 'superadmin'
        and status = 'active'`,
  );
  return Number(result.rows[0]?.count ?? "0");
}

describe("защита последнего суперадминистратора", () => {
  it("разрешает снять одного из двух активных суперадминистраторов", async () => {
    const result = await db.transaction(async (tx) =>
      updateVendorUserGuarded(tx as unknown as Database, firstAdminId, {
        role: "finance",
      }),
    );

    expect(result).toMatchObject({
      before: { id: firstAdminId, role: "superadmin" },
      after: { id: firstAdminId, role: "finance" },
    });
    expect(await activeSuperadmins()).toBe(1);
  });

  it("не даёт снять последнего активного суперадминистратора", async () => {
    await expect(
      db.transaction(async (tx) =>
        updateVendorUserGuarded(tx as unknown as Database, secondAdminId, {
          role: "finance",
        }),
      ),
    ).rejects.toBeInstanceOf(LastSuperadminError);
    expect(await activeSuperadmins()).toBe(1);
  });

  it("при конкурентном снятии двух администраторов оставляет одного", async () => {
    await database.pool.query(
      `update vendor_users set role = 'superadmin', status = 'active' where id = $1`,
      [firstAdminId],
    );
    expect(await activeSuperadmins()).toBe(2);

    const dbA = createDatabase(database.pool);
    const dbB = createDatabase(database.pool);
    const results = await Promise.allSettled([
      dbA.transaction(async (tx) =>
        updateVendorUserGuarded(tx as unknown as Database, firstAdminId, {
          role: "finance",
        }),
      ),
      dbB.transaction(async (tx) =>
        updateVendorUserGuarded(tx as unknown as Database, secondAdminId, {
          role: "finance",
        }),
      ),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(LastSuperadminError);
    expect(await activeSuperadmins()).toBe(1);
  });
});
