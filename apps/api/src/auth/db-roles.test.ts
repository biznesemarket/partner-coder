import { describe, expect, it } from "vitest";

import { roleSeparationErrors, type RoleFacts } from "./db-roles.js";

function facts(overrides: Partial<RoleFacts> = {}): RoleFacts {
  return {
    currentUser: "partner_coder_login",
    isSuperuser: false,
    bypassRls: false,
    authMember: false,
    apiMember: false,
    vendorMember: false,
    vendorAuthMember: false,
    workerMember: false,
    ...overrides,
  };
}

const base = facts({ currentUser: "partner_coder_api_login", apiMember: true });

describe("проверка разделения ролей БД", () => {
  it("принимает корректный API-логин", () => {
    expect(roleSeparationErrors("api", base)).toEqual([]);
  });

  it("принимает корректный auth-логин", () => {
    expect(
      roleSeparationErrors(
        "auth",
        facts({ currentUser: "partner_coder_auth_login", authMember: true }),
      ),
    ).toEqual([]);
  });

  it("принимает корректный vendor-логин", () => {
    expect(
      roleSeparationErrors(
        "vendor",
        facts({ currentUser: "partner_coder_vendor_login", vendorMember: true }),
      ),
    ).toEqual([]);
  });

  it("принимает корректный vendor_auth-логин", () => {
    expect(
      roleSeparationErrors(
        "vendor_auth",
        facts({ currentUser: "partner_coder_vendor_auth_login", vendorAuthMember: true }),
      ),
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

  it("vendor-логин не должен быть в api/auth/worker/vendor_auth", () => {
    const cases = ["apiMember", "authMember", "workerMember", "vendorAuthMember"] as const;
    for (const member of cases) {
      expect(
        roleSeparationErrors("vendor", facts({ vendorMember: true, [member]: true })),
      ).toHaveLength(1);
    }
  });

  it("vendor_auth-логин не должен быть в api/auth/worker/vendor", () => {
    const cases = ["apiMember", "authMember", "workerMember", "vendorMember"] as const;
    for (const member of cases) {
      expect(
        roleSeparationErrors("vendor_auth", facts({ vendorAuthMember: true, [member]: true })),
      ).toHaveLength(1);
    }
  });

  it("vendor_auth-логин не допустим для api и auth", () => {
    expect(
      roleSeparationErrors("api", facts({ apiMember: true, vendorAuthMember: true })),
    ).toHaveLength(1);
    expect(
      roleSeparationErrors("auth", facts({ authMember: true, vendorAuthMember: true })),
    ).toHaveLength(1);
  });

  it("требует нужную роль", () => {
    expect(roleSeparationErrors("api", facts()).join("\n")).toMatch(/partner_coder_api/);
    expect(roleSeparationErrors("auth", facts()).join("\n")).toMatch(/partner_coder_auth/);
    expect(roleSeparationErrors("vendor", facts()).join("\n")).toMatch(/partner_coder_vendor/);
    expect(roleSeparationErrors("vendor_auth", facts()).join("\n")).toMatch(
      /partner_coder_vendor_auth/,
    );
  });
});
