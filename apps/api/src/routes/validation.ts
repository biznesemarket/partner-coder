import type { z } from "zod";

import { ApiError } from "../errors.js";

export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ApiError(400, "validation_error", "Некорректные данные запроса", {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }
  return result.data;
}

export function parseParams<T>(schema: z.ZodType<T>, params: unknown): T {
  return parseBody(schema, params);
}

export function parseQuery<T>(schema: z.ZodType<T>, query: unknown): T {
  return parseBody(schema, query);
}
