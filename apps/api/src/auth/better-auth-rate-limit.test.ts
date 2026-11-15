import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "@partner-coder/db";

import {
  createPoolForDatabase,
  createTestDatabase,
  type TestDatabase,
} from "../../../../packages/db/test/helpers.js";
import { createAuth } from "./config.js";
import { MemoryMailer } from "./mailer.js";

const authSecret = "test-secret-test-secret-test-secret-1234";
const baseURL = "http://localhost:4000";
const webBaseURL = "http://localhost:3000";

describe("Better Auth: общий database rate limit", () => {
  let database: TestDatabase;
  let secondPool: ReturnType<typeof createPoolForDatabase>;
  let firstDb: Database;
  let secondDb: Database;

  beforeAll(async () => {
    database = await createTestDatabase();
    secondPool = createPoolForDatabase(database);
    firstDb = createDatabase(database.pool);
    secondDb = createDatabase(secondPool);
  }, 120_000);

  afterAll(async () => {
    await secondPool?.end();
    await database?.drop();
  }, 60_000);

  function buildAuth(db: Database) {
    return createAuth({
      db,
      secret: authSecret,
      baseURL,
      webBaseURL,
      sessionTtlHours: 12,
      magicLinkTtlMinutes: 30,
      mailer: new MemoryMailer(),
      rateLimitStorage: "database",
      rateLimitMax: 3,
      rateLimitWindowSeconds: 60,
      ipAddressHeaders: ["x-forwarded-for"],
    });
  }

  it("делит счетчик между инстансами и сохраняет его в PostgreSQL", async () => {
    const first = buildAuth(firstDb);
    const second = buildAuth(secondDb);
    const headers = { "x-forwarded-for": "203.0.113.77" };

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const response = await first.handler(
        new Request(`${baseURL}/api/auth/get-session`, { headers }),
      );
      expect(response.status, `попытка ${attempt}`).not.toBe(429);
    }

    const blocked = await first.handler(
      new Request(`${baseURL}/api/auth/get-session`, { headers }),
    );
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("x-retry-after")).toBeTruthy();

    const blockedOnSecondInstance = await second.handler(
      new Request(`${baseURL}/api/auth/get-session`, { headers }),
    );
    expect(blockedOnSecondInstance.status).toBe(429);

    const rows = await database.pool.query<{ count: number }>(
      "select count from auth_rate_limits where key like $1",
      ["%203.0.113.77%"],
    );
    expect(rows.rows[0]?.count).toBe(3);
  });
});
