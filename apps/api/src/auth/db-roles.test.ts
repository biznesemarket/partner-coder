import { describe, expect, it } from "vitest";

import { roleSeparationErrors, type RoleFacts } from "./db-roles.js";

const base: RoleFacts = {
  currentUser: "partner_coder_api_login",
  isSuperuser: false,
  bypassRls: false,
  authMember: false,
  apiMember: true,
  vendorMember: false,
  workerMember: false,
};

describe("проверка разделения ролей БД", () => {
  it("принимает корректный API-логин", () => {
    expect(roleSeparationErrors("api", base)).toEqual([]);
  });

  it("принимает корректный auth-логин", () => {
    expect(
      roleSeparationErrors("auth", {
        ...base,
        currentUser: "partner_coder_auth_login",
        apiMember: false,
        authMember: true,
      }),
    ).toEqual([]);
  });

  it("запрещает суперпользователя и BYPASSRLS", () => {
    const errors = roleSeparationErrors("api", {
      ...base,
      isSuperuser: true,
      bypassRls: true,
    });
    expect(errors.join("\n")).toMatch(/суперпользователь/);
    expect(errors.join("\n")).toMatch(/BYPASSRLS/);
  });

  it("запрещает auth-логину доступ к API-роли", () => {
    const errors = roleSeparationErrors("auth", {
      ...base,
      currentUser: "both",
      authMember: true,
      apiMember: true,
    });
    expect(errors.join("\n")).toMatch(/не должен быть членом/);
  });

  it("требует нужную роль", () => {
    expect(roleSeparationErrors("api", { ...base, apiMember: false }).join("\n")).toMatch(
      /partner_coder_api/,
    );
    expect(
      roleSeparationErrors("auth", {
        ...base,
        currentUser: "auth",
        apiMember: false,
        authMember: false,
      }).join("\n"),
    ).toMatch(/partner_coder_auth/);
  });
});
