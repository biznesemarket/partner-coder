import { describe, expect, it } from "vitest";

import { EnvValidationError, parseEnv } from "./env.js";

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

  it("пустая строка в опциональном поле становится undefined", () => {
    const env = parseEnv({ ...validEnv, TELEGRAM_BOT_TOKEN: "" });
    expect(env.TELEGRAM_BOT_TOKEN).toBeUndefined();
  });
});
