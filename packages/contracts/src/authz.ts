/**
 * Матрица авторизации tenant-контура: роль × ресурс × действие.
 *
 * Матрица намеренно не зависит от БД и HTTP: ее используют API, worker и тесты.
 * Tenant-изоляция проверяется отдельно и имеет приоритет над ролевыми правами:
 * действие в чужом tenant запрещено даже роли, которой оно разрешено дома.
 */

export const tenantRoles = ["director", "developer", "finance", "support"] as const;

export type TenantRole = (typeof tenantRoles)[number];

export const authzResources = [
  "tenant",
  "membership",
  "invitation",
  "project",
  "policy",
  "rate_version",
  "valuation_version",
  "day_record",
  "day_adjustment",
  "day_flag",
  "dispute",
  "payout",
  "report",
  "integration",
  "audit",
  "notification",
  "device",
  "agent_session",
  "profile",
] as const;

export type AuthzResource = (typeof authzResources)[number];

export const authzActions = ["read", "create", "update", "delete", "approve", "export"] as const;

export type AuthzAction = (typeof authzActions)[number];

const matrix: Record<TenantRole, Record<AuthzResource, readonly AuthzAction[]>> = {
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

const allowedSets = {} as Record<TenantRole, Record<AuthzResource, ReadonlySet<AuthzAction>>>;
for (const role of tenantRoles) {
  allowedSets[role] = {} as Record<AuthzResource, ReadonlySet<AuthzAction>>;
  for (const resource of authzResources) {
    allowedSets[role][resource] = new Set(matrix[role][resource]);
  }
}

export function isTenantRole(value: string): value is TenantRole {
  return (tenantRoles as readonly string[]).includes(value);
}

/** Проверяет ролевое право без tenant-контекста. */
export function can(role: TenantRole, resource: AuthzResource, action: AuthzAction): boolean {
  const set = allowedSets[role]?.[resource];
  return set ? set.has(action) : false;
}

export type AuthzDenialReason = "cross_tenant" | "tenant_required" | "role_denied";

export interface AuthorizeInput {
  readonly role: TenantRole;
  readonly resource: AuthzResource;
  readonly action: AuthzAction;
  readonly actorTenantId: string | null;
  readonly resourceTenantId: string | null;
}

export type AuthzDecision =
  | { readonly allowed: true; readonly reason: "allowed" }
  | { readonly allowed: false; readonly reason: AuthzDenialReason };

/**
 * Полная проверка: чужой tenant и отсутствие контекста запрещают действие
 * раньше ролевой проверки. Причина отказа попадает в аудит и ответ API.
 */
export function authorize(input: AuthorizeInput): AuthzDecision {
  if (!isTenantRole(input.role)) {
    return { allowed: false, reason: "role_denied" };
  }
  if (!input.actorTenantId || !input.resourceTenantId) {
    return { allowed: false, reason: "tenant_required" };
  }
  if (input.actorTenantId !== input.resourceTenantId) {
    return { allowed: false, reason: "cross_tenant" };
  }
  if (!can(input.role, input.resource, input.action)) {
    return { allowed: false, reason: "role_denied" };
  }
  return { allowed: true, reason: "allowed" };
}
