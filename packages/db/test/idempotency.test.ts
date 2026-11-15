import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "./helpers.js";
import { withIdempotency, IdempotencyConflictError } from "../src/idempotency.js";

const hash = (char: string) => char.repeat(64);

describe("идемпотентность", () => {
  let database: TestDatabase;
  let tenantId: string;
  let otherTenantId: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    const { rows } = await database.pool.query<{ id: string }>(
      `insert into customers (legal_name) values ('Идемпотентность') returning id`,
    );
    const customerId = rows[0]?.id;
    const tenant = await database.pool.query<{ id: string }>(
      `insert into tenants (customer_id, name, slug, status)
       values ($1, 'Идемпотентность', 'idempotency', 'active') returning id`,
      [customerId],
    );
    tenantId = tenant.rows[0]?.id ?? "";
    const other = await database.pool.query<{ id: string }>(
      `insert into tenants (customer_id, name, slug, status)
       values ($1, 'Идемпотентность 2', 'idempotency-2', 'active') returning id`,
      [customerId],
    );
    otherTenantId = other.rows[0]?.id ?? "";
  }, 120_000);

  afterAll(async () => {
    await database?.drop();
  }, 60_000);

  it("возвращает сохраненный ответ при повторе и не вызывает операцию дважды", async () => {
    let calls = 0;
    const options = {
      tenantId,
      scope: "POST /v1/tenant/invoices",
      key: "key-1",
      requestHash: hash("a"),
    };
    const first = await withIdempotency(database.db, options, async () => {
      calls += 1;
      return { statusCode: 201, body: { id: "invoice-1" } };
    });
    const second = await withIdempotency(database.db, options, async () => {
      calls += 1;
      return { statusCode: 201, body: { id: "invoice-2" } };
    });

    expect(first).toMatchObject({ statusCode: 201, body: { id: "invoice-1" }, replayed: false });
    expect(second).toMatchObject({ statusCode: 201, body: { id: "invoice-1" }, replayed: true });
    expect(calls).toBe(1);
  });

  it("отклоняет тот же ключ с другим телом запроса", async () => {
    const options = {
      tenantId,
      scope: "POST /v1/tenant/invoices",
      key: "key-2",
      requestHash: hash("b"),
    };
    await withIdempotency(database.db, options, async () => ({
      statusCode: 201,
      body: { ok: true },
    }));

    const conflict = withIdempotency(
      database.db,
      { ...options, requestHash: hash("c") },
      async () => ({ statusCode: 201, body: { ok: false } }),
    );
    await expect(conflict).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it("не смешивает ключи разных tenant и vendor", async () => {
    const scope = "POST /v1/tenant/test";
    const key = "shared-key";

    const a = await withIdempotency(
      database.db,
      { tenantId, scope, key, requestHash: hash("d") },
      async () => ({ statusCode: 200, body: { owner: "a" } }),
    );
    const b = await withIdempotency(
      database.db,
      { tenantId: otherTenantId, scope, key, requestHash: hash("d") },
      async () => ({ statusCode: 200, body: { owner: "b" } }),
    );
    const vendor = await withIdempotency(
      database.db,
      { tenantId: null, scope, key, requestHash: hash("d") },
      async () => ({ statusCode: 200, body: { owner: "vendor" } }),
    );

    expect(a.body).toEqual({ owner: "a" });
    expect(b.body).toEqual({ owner: "b" });
    expect(vendor.body).toEqual({ owner: "vendor" });
  });

  it("не сохраняет ключ, если операция упала", async () => {
    let calls = 0;
    const options = {
      tenantId,
      scope: "POST /v1/tenant/fail",
      key: "fail-key",
      requestHash: hash("e"),
    };
    const failing = withIdempotency(database.db, options, async () => {
      calls += 1;
      throw new Error("boom");
    });
    await expect(failing).rejects.toThrow("boom");
    expect(calls).toBe(1);

    const retry = await withIdempotency(database.db, options, async () => {
      calls += 1;
      return { statusCode: 200, body: { ok: true } };
    });
    expect(retry.replayed).toBe(false);
    expect(calls).toBe(2);
  });

  it("переиспользует ключ после истечения TTL", async () => {
    let calls = 0;
    const options = {
      tenantId,
      scope: "POST /v1/tenant/expired",
      key: "expired-key",
      requestHash: hash("1"),
      ttlSeconds: -1,
    };
    const first = await withIdempotency(database.db, options, async () => {
      calls += 1;
      return { statusCode: 200, body: { attempt: 1 } };
    });
    const second = await withIdempotency(database.db, options, async () => {
      calls += 1;
      return { statusCode: 200, body: { attempt: 2 } };
    });

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(false);
    expect(calls).toBe(2);
    expect(first.body).toEqual({ attempt: 1 });
    expect(second.body).toEqual({ attempt: 2 });
  });

  it("при параллельных запросах выполняет операцию один раз", async () => {
    let calls = 0;
    const options = {
      tenantId,
      scope: "POST /v1/tenant/concurrent",
      key: "concurrent-key",
      requestHash: hash("f"),
    };
    const run = () =>
      withIdempotency(database.db, options, async () => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 100));
        return { statusCode: 200, body: { ok: true } };
      });
    const [first, second] = await Promise.all([run(), run()]);
    expect(calls).toBe(1);
    expect([first.replayed, second.replayed].sort()).toEqual([false, true]);
  });
});
