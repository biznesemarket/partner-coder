import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Общий для нескольких API-инстансов счетчик per-email лимитов OTP/magic-link.
 * Ключ — нормализованный email; окно фиксированное. Таблица не tenant-ская:
 * лимит действует до аутентификации, поэтому RLS-политика разрешает доступ
 * только роли API и worker (для очистки).
 */
export const emailRateLimits = pgTable(
  "email_rate_limits",
  {
    key: text("key").primaryKey(),
    count: integer("count").notNull().default(0),
    windowStartedAt: timestamp("window_started_at", {
      withTimezone: true,
      precision: 3,
    }).notNull(),
  },
  (t) => [
    index("email_rate_limits_window_idx").on(t.windowStartedAt),
    check("email_rate_limits_count_chk", sql`${t.count} >= 0`),
  ],
);
