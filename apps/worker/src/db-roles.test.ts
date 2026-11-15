import { describe, expect, it } from "vitest";

import { workerRoleErrors } from "./db-roles.js";

describe("проверка роли worker", () => {
  it("принимает login, который состоит только в partner_coder_worker", () => {
    expect(
      workerRoleErrors({
        rolname: "partner_coder_worker_login",
        rolsuper: false,
        workerMember: true,
        apiMember: false,
        authMember: false,
      }),
    ).toEqual([]);
  });

  it("запрещает superuser и смешение ролей", () => {
    expect(
      workerRoleErrors({
        rolname: "bad",
        rolsuper: true,
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
        workerMember: false,
        apiMember: false,
        authMember: false,
      }),
    ).toEqual(["login api-only: нет членства partner_coder_worker"]);
  });
});
