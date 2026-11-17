import { describe, expect, it } from "vitest";

import { mapAuthError } from "./errors";

describe("mapAuthError", () => {
  it("маппит коды Better Auth в русские тексты", () => {
    expect(mapAuthError({ code: "INVALID_EMAIL_OR_PASSWORD" })).toMatch(/Неверный email/);
    expect(mapAuthError({ status: 429 })).toMatch(/Слишком много/);
    expect(mapAuthError({ code: "VENDOR_INACTIVE" })).toMatch(/заблокирована/);
    expect(mapAuthError({ code: "UNKNOWN" })).toMatch(/Не удалось/);
  });

  it.each([
    ["INVALID_CREDENTIALS", /Неверный email/],
    ["INVALID_PASSWORD", /Неверный пароль/],
    ["ACCOUNT_TEMPORARILY_LOCKED", /Слишком много/],
    ["INVALID_CODE", /Неверный код/],
    ["INVALID_TWO_FACTOR_CODE", /Неверный код/],
    ["INVALID_TWO_FACTOR_COOKIE", /Сессия входа истекла/],
    ["SESSION_EXPIRED", /Сессия входа истекла/],
    ["TOTP_ALREADY_ENABLED", /TOTP уже включён/],
    ["SESSION_NOT_FRESH", /Сессия устарела/],
    ["PREVIOUSLY_REGISTERED", /уже зарегистрирован/],
    ["ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED", /уже зарегистрирован/],
    ["ERROR_AUTHENTICATOR_NO_SUPPORTED_PUBKEYCREDPARAMS_ALG", /не поддерживает/],
    ["ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT", /не поддерживает/],
    ["ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT", /не поддерживает/],
    ["AUTH_CANCELLED", /отменено/],
    ["REGISTRATION_CANCELLED", /отменено/],
    ["vendor_mfa_required", /Сначала включите TOTP/],
    ["vendor_step_up_required", /повторное подтверждение пароля/],
    ["upstream_unavailable", /Сервис временно недоступен/],
  ])("маппит код %s", (code, expected) => {
    expect(mapAuthError({ code })).toMatch(expected);
  });

  it.each([
    [401, /Сессия истекла/],
    [500, /Сервис временно недоступен/],
    [503, /Сервис временно недоступен/],
  ])("маппит статус %i", (status, expected) => {
    expect(mapAuthError({ status })).toMatch(expected);
  });

  it("использует statusCode, если нет code и status", () => {
    expect(mapAuthError({ statusCode: 429 })).toMatch(/Слишком много/);
  });

  it("возвращает generic для пустого входа", () => {
    expect(mapAuthError(undefined)).toMatch(/Не удалось/);
    expect(mapAuthError({})).toMatch(/Не удалось/);
  });
});
