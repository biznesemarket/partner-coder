import { describe, expect, it } from "vitest";

import { workerRoleErrors } from "./db-roles.js";

describe("проверка роли worker", () => {
  it("принимает login с BYPASSRLS, который состоит только в partner_coder_worker", () => {
    expect(
      workerRoleErrors({
        rolname: "partner_coder_worker_login",
        rolsuper: false,
        rolbypassrls: true,
        workerMember: true,
        apiMember: false,
        authMember: false,
      }),
    ).toEqual([]);
  });

  it("требует BYPASSRLS на login: членство в роли его не наследует", () => {
    expect(
      workerRoleErrors({
        rolname: "worker-without-bypass",
        rolsuper: false,
        rolbypassrls: false,
        workerMember: true,
        apiMember: false,
        authMember: false,
      }),
    ).toEqual(["login worker-without-bypass: worker login должен иметь BYPASSRLS"]);
  });

  it("запрещает superuser и смешение ролей", () => {
    expect(
      workerRoleErrors({
        rolname: "bad",
        rolsuper: true,
        rolbypassrls: true,
        workerMember: true,
        apiMember: true,
        authMember: false,
      }),
    ).toEqual([
      "login bad: worker не должен быть superuser",
      "login bad: worker не должен входить в partner_coder_api",
    ]);

    expect(
      workerRoleErrors({
        rolname: "api-only",
        rolsuper: false,
        rolbypassrls: false,
        workerMember: false,
        apiMember: false,
        authMember: false,
      }),
    ).toEqual([
      "login api-only: worker login должен иметь BYPASSRLS",
      "login api-only: нет членства partner_coder_worker",
    ]);
  });
});
