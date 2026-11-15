import { describe, expect, it } from "vitest";

import {
  authzActions,
  authzResources,
  authorize,
  can,
  tenantRoles,
  type AuthzAction,
  type AuthzResource,
  type TenantRole,
} from "./authz.js";

/**
 * Независимая копия матрицы прав: тест не должен выводить ожидания из
 * реализации, иначе изменение матрицы останется незамеченным.
 */
const expected: Record<TenantRole, Partial<Record<AuthzResource, readonly AuthzAction[]>>> = {
  director: {
    tenant: ["read", "update"],
    membership: ["read", "create", "update", "delete"],
    invitation: ["read", "create", "delete"],
    project: ["read", "create", "update", "delete"],
    policy: ["read", "create", "update", "approve"],
    rate_version: ["read", "create", "approve"],
    valuation_version: ["read", "create", "approve"],
    day_record: ["read", "export"],
    day_adjustment: ["read", "create", "approve"],
    day_flag: ["read", "update"],
    dispute: ["read", "update", "approve"],
    payout: ["read", "create", "approve", "export"],
    report: ["read", "export"],
    integration: ["read", "create", "update", "delete"],
    audit: ["read", "export"],
    notification: ["read"],
    device: ["read", "create", "update", "delete"],
    agent_session: ["read"],
    profile: ["read", "update"],
  },
  developer: {
    tenant: ["read"],
    membership: ["read"],
    invitation: [],
    project: ["read"],
    policy: ["read"],
    rate_version: ["read"],
    valuation_version: ["read"],
    day_record: ["read", "export"],
    day_adjustment: ["read"],
    day_flag: ["read"],
    dispute: ["read", "create"],
    payout: ["read"],
    report: ["read"],
    integration: ["read"],
    audit: [],
    notification: ["read"],
    device: ["read", "create", "update", "delete"],
    agent_session: ["read", "create", "update"],
    profile: ["read", "update"],
  },
  finance: {
    tenant: ["read"],
    membership: ["read"],
    invitation: ["read"],
    project: ["read"],
    policy: ["read"],
    rate_version: ["read"],
    valuation_version: ["read"],
    day_record: ["read", "export"],
    day_adjustment: ["read"],
    day_flag: ["read"],
    dispute: ["read"],
    payout: ["read", "create", "approve", "export"],
    report: ["read", "export"],
    integration: ["read"],
    audit: ["read", "export"],
    notification: ["read"],
    device: ["read"],
    agent_session: [],
    profile: ["read", "update"],
  },
  support: {
    tenant: ["read"],
    membership: ["read"],
    invitation: ["read", "create", "delete"],
    project: ["read"],
    policy: ["read"],
    rate_version: ["read"],
    valuation_version: ["read"],
    day_record: ["read"],
    day_adjustment: ["read"],
    day_flag: ["read"],
    dispute: ["read", "update"],
    payout: ["read"],
    report: ["read"],
    integration: ["read"],
    audit: ["read"],
    notification: ["read"],
    device: ["read"],
    agent_session: ["read"],
    profile: ["read", "update"],
  },
};

describe("матрица authz: роль × ресурс × действие", () => {
  for (const role of tenantRoles) {
    for (const resource of authzResources) {
      for (const action of authzActions) {
        const allowed = expected[role][resource]?.includes(action) ?? false;
        const label = `${role} ${resource} ${action}`;
        it(`${label} → ${allowed ? "разрешено" : "запрещено"}`, () => {
          expect(can(role, resource, action)).toBe(allowed);
        });
      }
    }
  }
});

describe("авторизация с tenant-контекстом", () => {
  it("разрешает действие в своем tenant", () => {
    expect(
      authorize({
        role: "director",
        resource: "payout",
        action: "approve",
        actorTenantId: "tenant-a",
        resourceTenantId: "tenant-a",
      }),
    ).toEqual({ allowed: true, reason: "allowed" });
  });

  it("запрещает действие роли без права", () => {
    expect(
      authorize({
        role: "developer",
        resource: "payout",
        action: "approve",
        actorTenantId: "tenant-a",
        resourceTenantId: "tenant-a",
      }),
    ).toEqual({ allowed: false, reason: "role_denied" });
  });

  it("запрещает чужой tenant для каждой роли, ресурса и действия", () => {
    for (const role of tenantRoles) {
      for (const resource of authzResources) {
        for (const action of authzActions) {
          const decision = authorize({
            role,
            resource,
            action,
            actorTenantId: "tenant-a",
            resourceTenantId: "tenant-b",
          });
          expect(decision, `${role} ${resource} ${action}`).toEqual({
            allowed: false,
            reason: "cross_tenant",
          });
        }
      }
    }
  });

  it("запрещает доступ без tenant-контекста", () => {
    expect(
      authorize({
        role: "director",
        resource: "membership",
        action: "read",
        actorTenantId: null,
        resourceTenantId: "tenant-a",
      }),
    ).toEqual({ allowed: false, reason: "tenant_required" });
  });

  it("неизвестная роль не получает прав", () => {
    expect(
      authorize({
        role: "owner" as TenantRole,
        resource: "tenant",
        action: "read",
        actorTenantId: "tenant-a",
        resourceTenantId: "tenant-a",
      }),
    ).toEqual({ allowed: false, reason: "role_denied" });
  });
});
