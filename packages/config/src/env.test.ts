import { describe, expect, it } from "vitest";

import { EnvValidationError, parseEnv, parseList, resolveRateLimitStorage } from "./env.js";

const validEnv = {
  NODE_ENV: "test",
  APP_ENV: "local",
  DATABASE_URL: "postgres://partner:partner@localhost:5432/partner_coder",
  API_BASE_URL: "http://localhost:4000",
  WEB_BASE_URL: "http://localhost:3000",
  AUTH_SECRET: "0123456789abcdef0123456789abcdef",
  S3_ENDPOINT: "http://localhost:9000",
  S3_BUCKET: "partner-coder",
  S3_ACCESS_KEY: "partner",
  S3_SECRET_KEY: "partner-secret",
  SMTP_HOST: "localhost",
  SMTP_FROM: "Партнер кодер <no-reply@partnercoder.local>",
};

describe("валидация окружения", () => {
  it("применяет дефолты", () => {
    const env = parseEnv(validEnv);
    expect(env.API_PORT).toBe(4000);
    expect(env.PACKAGE_TTL_DAYS).toBe(7);
    expect(env.S3_FORCE_PATH_STYLE).toBe(true);
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.WORKER_METRICS_PORT).toBe(4100);
    expect(env.PG_BOSS_SCHEMA).toBe("pgboss");
    expect(env.DAY_CLOSE_CRON).toBe("*/15 * * * *");
    expect(env.HEARTBEAT_RETENTION_DAYS).toBe(90);
  });

  it("проверяет имя схемы pg-boss", () => {
    try {
      parseEnv({ ...validEnv, PG_BOSS_SCHEMA: "pg-boss" });
      expect.unreachable("ожидалась ошибка валидации");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      expect((error as EnvValidationError).issues.join("\n")).toMatch(/PG_BOSS_SCHEMA/);
    }
  });

  it("падает с понятным списком проблем", () => {
    try {
      parseEnv({ ...validEnv, DATABASE_URL: "", AUTH_SECRET: "short" });
      expect.unreachable("ожидалась ошибка валидации");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const issues = (error as EnvValidationError).issues;
      expect(issues.join("\n")).toMatch(/DATABASE_URL/);
      expect(issues.join("\n")).toMatch(/AUTH_SECRET/);
    }
  });

  it("вне local требует отдельный AUTH_DATABASE_URL и не принимает пример секрета", () => {
    try {
      parseEnv({
        ...validEnv,
        APP_ENV: "staging",
        AUTH_SECRET: "local-dev-only-change-me-0123456789abcdef",
      });
      expect.unreachable("ожидалась ошибка валидации");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const issues = (error as EnvValidationError).issues.join("\\n");
      expect(issues).toMatch(/AUTH_DATABASE_URL/);
      expect(issues).toMatch(/AUTH_SECRET/);
    }
  });

  it("разбирает списки заголовков и прокси через запятую", () => {
    expect(parseList(" x-real-ip, ,x-forwarded-for ")).toEqual(["x-real-ip", "x-forwarded-for"]);
    expect(parseList(undefined)).toEqual([]);
  });

  it("пустая строка в опциональном поле становится undefined", () => {
    const env = parseEnv({ ...validEnv, TELEGRAM_BOT_TOKEN: "" });
    expect(env.TELEGRAM_BOT_TOKEN).toBeUndefined();
  });

  it("выбирает общий rate limit store вне local", () => {
    expect(parseEnv({ ...validEnv, RATE_LIMIT_STORAGE: "" }).RATE_LIMIT_STORAGE).toBeUndefined();
    expect(resolveRateLimitStorage({ APP_ENV: "local" })).toBe("memory");
    expect(resolveRateLimitStorage({ APP_ENV: "staging" })).toBe("database");
    expect(resolveRateLimitStorage({ APP_ENV: "prod" })).toBe("database");
    expect(resolveRateLimitStorage({ APP_ENV: "staging", RATE_LIMIT_STORAGE: "memory" })).toBe(
      "memory",
    );
  });

  it("применяет дефолты vendor-auth", () => {
    const env = parseEnv(validEnv);
    expect(env.VENDOR_SESSION_TTL_HOURS).toBe(8);
    expect(env.VENDOR_PASSWORD_RESET_TTL_MINUTES).toBe(30);
    expect(env.VENDOR_PASSWORD_MIN_LENGTH).toBe(12);
    expect(env.VENDOR_AUTH_SECRET).toBeUndefined();
  });

  it("вне local требует vendor URL и секрет", () => {
    expect(() =>
      parseEnv({
        ...validEnv,
        APP_ENV: "staging",
        AUTH_DATABASE_URL: "postgres://auth@localhost/partner_coder",
      }),
    ).toThrow(/VENDOR_DATABASE_URL/);
  });

  it("запрещает VENDOR_AUTH_SECRET === AUTH_SECRET вне local", () => {
    expect(() =>
      parseEnv({
        ...validEnv,
        APP_ENV: "staging",
        AUTH_DATABASE_URL: "postgres://auth@localhost/partner_coder",
        VENDOR_DATABASE_URL: "postgres://vendor@localhost/partner_coder",
        VENDOR_AUTH_DATABASE_URL: "postgres://vendor_auth@localhost/partner_coder",
        VENDOR_AUTH_SECRET: validEnv.AUTH_SECRET,
      }),
    ).toThrow(/VENDOR_AUTH_SECRET/);
  });

  it("ограничивает длину пароля и TTL", () => {
    expect(() => parseEnv({ ...validEnv, VENDOR_PASSWORD_MIN_LENGTH: "8" })).toThrow(
      /VENDOR_PASSWORD_MIN_LENGTH/,
    );
    expect(() => parseEnv({ ...validEnv, VENDOR_SESSION_TTL_HOURS: "25" })).toThrow(
      /VENDOR_SESSION_TTL_HOURS/,
    );
  });
});
