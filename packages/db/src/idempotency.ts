import { and, eq, isNull, lt, sql } from "drizzle-orm";

import type { Database, DbTransaction } from "./client.js";
import { idempotencyKeys } from "./schema/index.js";

export interface IdempotencyInput {
  readonly tenantId: string | null;
  readonly scope: string;
  readonly key: string;
  readonly requestHash: string;
  readonly ttlSeconds?: number;
}

export interface IdempotentResult<T> {
  readonly statusCode: number;
  readonly body: T;
}

export interface IdempotencyOutcome<T> extends IdempotentResult<T> {
  readonly replayed: boolean;
}

export class IdempotencyConflictError extends Error {
  readonly code = "idempotency_conflict";
  readonly statusCode = 409;

  constructor() {
    super("Idempotency-Key уже использован с другим телом запроса");
    this.name = "IdempotencyConflictError";
  }
}

export class IdempotencyInProgressError extends Error {
  readonly code = "idempotency_in_progress";
  readonly statusCode = 409;

  constructor() {
    super("Запрос с этим Idempotency-Key еще выполняется");
    this.name = "IdempotencyInProgressError";
  }
}

const DEFAULT_TTL_SECONDS = 24 * 60 * 60;

/**
 * Выполняет мутацию ровно один раз для пары (владелец, scope, ключ).
 *
 * Ключ и результат пишутся в той же транзакции, что и сама операция:
 * падение операции не оставляет «вечного» ключа, а повтор возвращает
 * сохраненный ответ. Tenant-контекст выставляется в транзакции, чтобы
 * RLS применялся к самой операции.
 */
export async function withIdempotency<T>(
  db: Database,
  input: IdempotencyInput,
  operation: (tx: DbTransaction) => Promise<IdempotentResult<T>>,
): Promise<IdempotencyOutcome<T>> {
  return db.transaction(async (tx) => {
    if (input.tenantId !== null) {
      await tx.execute(sql`select set_config('app.tenant_id', ${input.tenantId}, true)`);
    }

    const expiresAt = new Date(Date.now() + (input.ttlSeconds ?? DEFAULT_TTL_SECONDS) * 1000);
    const owner = input.tenantId
      ? eq(idempotencyKeys.tenantId, input.tenantId)
      : isNull(idempotencyKeys.tenantId);
    const keyWhere = and(
      owner,
      eq(idempotencyKeys.scope, input.scope),
      eq(idempotencyKeys.key, input.key),
    );

    await tx
      .delete(idempotencyKeys)
      .where(and(keyWhere, lt(idempotencyKeys.expiresAt, new Date())));

    const run = async (keyId: string): Promise<IdempotencyOutcome<T>> => {
      const result = await operation(tx);
      await tx
        .update(idempotencyKeys)
        .set({
          status: "completed",
          statusCode: result.statusCode,
          response: result.body ?? null,
        })
        .where(eq(idempotencyKeys.id, keyId));
      return { statusCode: result.statusCode, body: result.body, replayed: false };
    };

    const inserted = await tx
      .insert(idempotencyKeys)
      .values({
        tenantId: input.tenantId,
        scope: input.scope,
        key: input.key,
        requestHash: input.requestHash,
        status: "in_progress",
        expiresAt,
      })
      .onConflictDoNothing()
      .returning({ id: idempotencyKeys.id });

    const fresh = inserted[0];
    if (fresh) {
      return run(fresh.id);
    }

    const existing = await tx
      .select()
      .from(idempotencyKeys)
      .where(keyWhere)
      .limit(1)
      .then((rows) => rows[0]);

    if (!existing) {
      throw new IdempotencyInProgressError();
    }
    if (existing.requestHash !== input.requestHash) {
      throw new IdempotencyConflictError();
    }
    if (existing.status === "completed") {
      return {
        statusCode: existing.statusCode ?? 200,
        body: existing.response as T,
        replayed: true,
      };
    }
    throw new IdempotencyInProgressError();
  });
}
