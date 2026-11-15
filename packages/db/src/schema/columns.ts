import { sql } from "drizzle-orm";
import { bigint, customType, integer, jsonb, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const uuidPk = () => uuid("id").primaryKey().defaultRandom();

export const createdAt = () =>
  timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true, precision: 3 }).notNull().defaultNow();

export const tenantId = () => uuid("tenant_id").notNull();

/**
 * inet-колонка, которая принимает пустую строку от Better Auth как NULL:
 * библиотека пишет "" когда в запросе нет доверенных заголовков IP.
 */
const nullableInet = customType<{ data: string | null; driverData: string | null }>({
  dataType: () => "inet",
  toDriver: (value) => (value === "" ? null : value),
  fromDriver: (value) => value,
});

export const inetAddress = (name: string) => nullableInet(name);

export const kopecks = (name: string) => bigint(name, { mode: "bigint" }).notNull();

export const nullableKopecks = (name: string) => bigint(name, { mode: "bigint" });

export const shareUnits = (name: string) => bigint(name, { mode: "bigint" }).notNull();

export const intDefault = (name: string, value: number) => integer(name).notNull().default(value);

export const jsonObject = <T>(name: string) =>
  jsonb(name)
    .$type<T>()
    .notNull()
    .default(sql`'{}'::jsonb`);

export const jsonArray = <T>(name: string) =>
  jsonb(name)
    .$type<T>()
    .notNull()
    .default(sql`'[]'::jsonb`);

export const jsonNullable = <T>(name: string) => jsonb(name).$type<T>();

export const jsonValue = <T>(name: string) => jsonb(name).$type<T>().notNull();

export const hashColumn = (name: string) => text(name);

export const emailColumn = () => text("email").notNull();
