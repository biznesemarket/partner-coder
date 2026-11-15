import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "./helpers.js";
import { seedTenant, seedVendorBase, type TenantFixture } from "./fixtures.js";

describe("append-only и аудит", () => {
  let database: TestDatabase;
  let tenant: TenantFixture;

  beforeAll(async () => {
    database = await createTestDatabase();
    const base = await seedVendorBase(database.pool);
    tenant = await seedTenant(database.pool, base, "a");
  }, 120_000);

  afterAll(async () => {
    await database?.drop();
  }, 60_000);

  it("запрещает UPDATE и DELETE закрытых дней и журналов", async () => {
    for (const table of [
      "day_records",
      "day_adjustments",
      "day_flags",
      "heartbeats",
      "intervals",
      "tenant_audit_events",
    ]) {
      const update = database.pool.query(
        `update "${table}" set tenant_id = tenant_id where tenant_id = $1`,
        [tenant.tenantId],
      );
      await expect(update, `${table}: UPDATE разрешен`).rejects.toMatchObject({ code: "23514" });

      const remove = database.pool.query(`delete from "${table}" where tenant_id = $1`, [
        tenant.tenantId,
      ]);
      await expect(remove, `${table}: DELETE разрешен`).rejects.toMatchObject({ code: "23514" });
    }
  });

  it("строит и проверяет хеш-цепочку tenant-аудита", async () => {
    for (const action of ["policy.approved", "payout.created"]) {
      await database.pool.query(
        `insert into tenant_audit_events (tenant_id, actor, actor_type, action, entity, after)
         values ($1, $2, 'user', $3, 'test.entity', '{"ok": true}'::jsonb)`,
        [tenant.tenantId, tenant.userId, action],
      );
    }

    const { rows } = await database.pool.query<{ valid: boolean; count: string }>(
      `select verify_tenant_audit_chain($1) as valid,
              (select count(*) from tenant_audit_events where tenant_id = $1) as count`,
      [tenant.tenantId],
    );
    expect(Number(rows[0]?.count)).toBe(3);
    expect(rows[0]?.valid).toBe(true);

    const chain = await database.pool.query<{
      prev_hash: string | null;
      hash: string;
      chain_seq: string;
    }>(
      `select prev_hash, hash, chain_seq from tenant_audit_events
        where tenant_id = $1 order by chain_seq asc`,
      [tenant.tenantId],
    );
    expect(chain.rows.map((row) => Number(row.chain_seq))).toEqual([1, 2, 3]);
    expect(chain.rows[0]?.prev_hash).toBeNull();
    expect(chain.rows[1]?.prev_hash).toBe(chain.rows[0]?.hash);
    expect(chain.rows[2]?.prev_hash).toBe(chain.rows[1]?.hash);
  });

  it("обнаруживает подмену события аудита", async () => {
    const client = await database.pool.connect();
    try {
      await client.query("begin");
      await client.query("set local session_replication_role = replica");
      await client.query(
        `update tenant_audit_events
            set after = '{"tampered": true}'::jsonb
          where id = (select id from tenant_audit_events where tenant_id = $1 limit 1)`,
        [tenant.tenantId],
      );
      await client.query("commit");
    } finally {
      client.release();
    }

    const { rows } = await database.pool.query<{ valid: boolean }>(
      "select verify_tenant_audit_chain($1) as valid",
      [tenant.tenantId],
    );
    expect(rows[0]?.valid).toBe(false);
  });

  it("замечает перенос разделителя между action и entity", async () => {
    const { rows: customerRows } = await database.pool.query<{ customer_id: string }>(
      "select customer_id from tenants where id = $1",
      [tenant.tenantId],
    );
    const { rows: tenantRows } = await database.pool.query<{ id: string }>(
      `insert into tenants (customer_id, name, slug, status)
       values ($1, 'Разделитель', 'delimiter-test', 'active') returning id`,
      [customerRows[0]?.customer_id],
    );
    const otherTenant = tenantRows[0]!.id;
    await database.pool.query(
      `insert into tenant_audit_events (tenant_id, actor_type, action, entity)
       values ($1, 'system', 'A', 'B|C')`,
      [otherTenant],
    );

    const client = await database.pool.connect();
    try {
      await client.query("begin");
      await client.query("set local session_replication_role = replica");
      await client.query(
        `update tenant_audit_events
            set action = 'A|B', entity = 'C'
          where tenant_id = $1`,
        [otherTenant],
      );
      await client.query("commit");
    } finally {
      client.release();
    }

    const { rows } = await database.pool.query<{ valid: boolean }>(
      "select verify_tenant_audit_chain($1) as valid",
      [otherTenant],
    );
    expect(rows[0]?.valid).toBe(false);
  });

  it("фиксирует ежедневный якорь tenant-аудита", async () => {
    const { rows: before } = await database.pool.query<{ count: string }>(
      `select count(*) from tenant_audit_events
        where tenant_id = $1 and (created_at at time zone 'UTC')::date = current_date`,
      [tenant.tenantId],
    );
    const { rows } = await database.pool.query<{ hash: string | null }>(
      "select anchor_tenant_audit($1, current_date) as hash",
      [tenant.tenantId],
    );
    expect(rows[0]?.hash).toBeTruthy();

    const anchor = await database.pool.query<{ last_hash: string; event_count: number }>(
      "select last_hash, event_count from tenant_audit_anchors where tenant_id = $1 and date = current_date",
      [tenant.tenantId],
    );
    expect(anchor.rows[0]?.last_hash).toBe(rows[0]?.hash);
    expect(anchor.rows[0]?.event_count).toBe(Number(before[0]?.count));

    const verified = await database.pool.query<{ valid: boolean }>(
      "select verify_tenant_audit_anchor($1, current_date) as valid",
      [tenant.tenantId],
    );
    expect(verified.rows[0]?.valid).toBe(true);

    await database.pool.query("select anchor_tenant_audit($1, current_date)", [tenant.tenantId]);
    const again = await database.pool.query<{ count: string }>(
      "select count(*) from tenant_audit_anchors where tenant_id = $1 and date = current_date",
      [tenant.tenantId],
    );
    expect(Number(again.rows[0]?.count)).toBe(1);
  });

  it("ведет отдельную цепочку вендорского аудита и замечает подмену customer_id", async () => {
    await database.pool.query(
      `insert into vendor_audit_events (action, entity, after)
       values ('customer.created', 'customer', '{"id": 1}'::jsonb)`,
    );
    await database.pool.query(
      `insert into vendor_audit_events (action, entity, after)
       values ('invoice.issued', 'invoice', '{"id": 2}'::jsonb)`,
    );

    const { rows } = await database.pool.query<{ valid: boolean }>(
      "select verify_vendor_audit_chain() as valid",
    );
    expect(rows[0]?.valid).toBe(true);

    const anchor = await database.pool.query<{ hash: string | null }>(
      "select anchor_vendor_audit(current_date) as hash",
    );
    expect(anchor.rows[0]?.hash).toBeTruthy();

    const client = await database.pool.connect();
    try {
      await client.query("begin");
      await client.query("set local session_replication_role = replica");
      await client.query(
        `update vendor_audit_events
            set customer_id = '00000000-0000-4000-8000-000000000001'::uuid
          where id = (select id from vendor_audit_events order by chain_seq limit 1)`,
      );
      await client.query("commit");
    } finally {
      client.release();
    }

    const tampered = await database.pool.query<{ valid: boolean }>(
      "select verify_vendor_audit_chain() as valid",
    );
    expect(tampered.rows[0]?.valid).toBe(false);
  });
});
