import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  asRole,
  asTenant,
  createTestDatabase,
  VENDOR_ROLE,
  type TestDatabase,
} from "../../../packages/db/test/helpers.js";
import { seedDemo } from "../src/seed.js";

describe("seed демо-данных", () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, 120_000);

  afterAll(async () => {
    await database?.drop();
  }, 60_000);

  it("создает вендора, клиента, проект, политику, 3 разработчиков и 5 дней", async () => {
    const summary = await seedDemo(database.db);
    expect(summary.developers).toBe(3);
    expect(summary.days).toBe(5);
    expect(summary.dayRecords).toBe(15);

    const counts = await database.pool.query<{
      vendor_users: string;
      customers: string;
      plans: string;
      tenants: string;
      projects: string;
      policies: string;
      developers: string;
      day_records: string;
      distinct_days: string;
    }>(
      `select
         (select count(*) from vendor_users) as vendor_users,
         (select count(*) from customers) as customers,
         (select count(*) from plans) as plans,
         (select count(*) from tenants) as tenants,
         (select count(*) from projects) as projects,
         (select count(*) from policies) as policies,
         (select count(*) from memberships where role = 'developer') as developers,
         (select count(*) from day_records) as day_records,
         (select count(distinct date_local) from day_records) as distinct_days`,
    );
    expect(counts.rows[0]).toMatchObject({
      vendor_users: "1",
      customers: "1",
      plans: "1",
      tenants: "1",
      projects: "1",
      policies: "1",
      developers: "3",
      day_records: "15",
      distinct_days: "5",
    });

    const amounts = await database.pool.query<{
      invalid_split: string;
      invalid_hash: string;
      zero_days: string;
    }>(
      `select
         count(*) filter (where cash_kopecks + equity_kopecks <> amount_kopecks) as invalid_split,
         count(*) filter (where input_hash !~ '^[0-9a-f]{64}$') as invalid_hash,
         count(*) filter (where paid_seconds <= 0 or amount_kopecks <= 0) as zero_days
       from day_records`,
    );
    expect(amounts.rows[0]).toEqual({
      invalid_split: "0",
      invalid_hash: "0",
      zero_days: "0",
    });
  });

  it("идемпотентен: повторный запуск не дублирует записи", async () => {
    const summary = await seedDemo(database.db);
    expect(summary.dayRecords).toBe(15);

    const counts = await database.pool.query<{
      vendor_users: string;
      customers: string;
      users: string;
      memberships: string;
      day_records: string;
      intervals: string;
      heartbeats: string;
    }>(
      `select
         (select count(*) from vendor_users) as vendor_users,
         (select count(*) from customers) as customers,
         (select count(*) from users) as users,
         (select count(*) from memberships) as memberships,
         (select count(*) from day_records) as day_records,
         (select count(*) from intervals) as intervals,
         (select count(*) from heartbeats) as heartbeats`,
    );
    expect(counts.rows[0]).toEqual({
      vendor_users: "1",
      customers: "1",
      users: "4",
      memberships: "4",
      day_records: "15",
      intervals: "45",
      heartbeats: "45",
    });
  });

  it("создаёт демо-вендора с twoFactorEnabled = false", async () => {
    const { rows } = await database.pool.query<{ two_factor_enabled: boolean }>(
      `select mfa_enabled as two_factor_enabled
         from vendor_users
        where email = 'vendor@demo.partnercoder.local'`,
    );
    expect(rows[0]?.two_factor_enabled).toBe(false);
  });

  it("данные видны через RLS своего tenant и вендорской роли", async () => {
    const { rows } = await database.pool.query<{ tenant_id: string }>(
      "select tenant_id from day_records limit 1",
    );
    const tenantId = rows[0]?.tenant_id ?? "";

    const visible = await asTenant(database.pool, tenantId, async (client) => {
      const days = await client.query<{ count: string }>("select count(*) from day_records");
      const projects = await client.query<{ count: string }>("select count(*) from projects");
      const members = await client.query<{ count: string }>("select count(*) from memberships");
      return {
        days: Number(days.rows[0]?.count),
        projects: Number(projects.rows[0]?.count),
        members: Number(members.rows[0]?.count),
      };
    });
    expect(visible).toEqual({ days: 15, projects: 1, members: 4 });

    const customers = await asRole(database.pool, VENDOR_ROLE, async (client) => {
      const result = await client.query<{ count: string }>("select count(*) from customers");
      return Number(result.rows[0]?.count);
    });
    expect(customers).toBe(1);
  });
});
