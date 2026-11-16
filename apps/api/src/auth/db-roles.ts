export type DbRoleScope = "api" | "auth" | "vendor" | "vendor_auth";

export interface RoleFacts {
  readonly currentUser: string;
  readonly isSuperuser: boolean;
  readonly bypassRls: boolean;
  readonly authMember: boolean;
  readonly apiMember: boolean;
  readonly vendorMember: boolean;
  readonly vendorAuthMember: boolean;
  readonly workerMember: boolean;
}

export interface RoleFactsQuery {
  readonly rows: readonly {
    current_user: string;
    is_superuser: boolean;
    bypass_rls: boolean;
    auth_member: boolean;
    api_member: boolean;
    vendor_member: boolean;
    vendor_auth_member: boolean;
    worker_member: boolean;
  }[];
}

const roleFactsSql = `
  select current_user as current_user,
         coalesce((select rolsuper from pg_roles where rolname = current_user), false) as is_superuser,
         coalesce((select rolbypassrls from pg_roles where rolname = current_user), false) as bypass_rls,
         pg_has_role(current_user, 'partner_coder_auth', 'member') as auth_member,
         pg_has_role(current_user, 'partner_coder_api', 'member') as api_member,
         pg_has_role(current_user, 'partner_coder_vendor', 'member') as vendor_member,
         pg_has_role(current_user, 'partner_coder_vendor_auth', 'member') as vendor_auth_member,
         pg_has_role(current_user, 'partner_coder_worker', 'member') as worker_member
`;

export async function readRoleFacts(
  query: (sql: string) => Promise<RoleFactsQuery>,
): Promise<RoleFacts> {
  const result = await query(roleFactsSql);
  const row = result.rows[0];
  if (!row) {
    throw new Error("Не удалось прочитать роль текущего подключения к PostgreSQL");
  }
  return {
    currentUser: row.current_user,
    isSuperuser: row.is_superuser,
    bypassRls: row.bypass_rls,
    authMember: row.auth_member,
    apiMember: row.api_member,
    vendorMember: row.vendor_member,
    vendorAuthMember: row.vendor_auth_member,
    workerMember: row.worker_member,
  };
}

/**
 * Проверяет, что подключения API, Better Auth, вендорских данных и вендорского
 * Better Auth не пересекаются и не являются суперпользователем/BYPASSRLS.
 * Возвращает список проблем; пусто — все хорошо.
 */
export function roleSeparationErrors(scope: DbRoleScope, facts: RoleFacts): string[] {
  const errors: string[] = [];
  if (facts.isSuperuser) {
    errors.push(`${facts.currentUser}: суперпользователь недопустим для ${scope}`);
  }
  if (facts.bypassRls) {
    errors.push(`${facts.currentUser}: BYPASSRLS недопустим для ${scope}`);
  }
  switch (scope) {
    case "api":
      if (!facts.apiMember) {
        errors.push(`${facts.currentUser}: нужна роль partner_coder_api`);
      }
      if (facts.authMember || facts.vendorMember || facts.vendorAuthMember || facts.workerMember) {
        errors.push(
          `${facts.currentUser}: API-логин не должен быть членом auth/vendor/vendor_auth/worker`,
        );
      }
      break;
    case "auth":
      if (!facts.authMember) {
        errors.push(`${facts.currentUser}: нужна роль partner_coder_auth`);
      }
      if (facts.apiMember || facts.vendorMember || facts.vendorAuthMember || facts.workerMember) {
        errors.push(
          `${facts.currentUser}: auth-логин не должен быть членом API/vendor/vendor_auth/worker`,
        );
      }
      break;
    case "vendor":
      if (!facts.vendorMember) {
        errors.push(`${facts.currentUser}: нужна роль partner_coder_vendor`);
      }
      if (facts.apiMember || facts.authMember || facts.vendorAuthMember || facts.workerMember) {
        errors.push(
          `${facts.currentUser}: vendor-логин не должен быть членом API/auth/vendor_auth/worker`,
        );
      }
      break;
    case "vendor_auth":
      if (!facts.vendorAuthMember) {
        errors.push(`${facts.currentUser}: нужна роль partner_coder_vendor_auth`);
      }
      if (facts.apiMember || facts.authMember || facts.vendorMember || facts.workerMember) {
        errors.push(
          `${facts.currentUser}: vendor_auth-логин не должен быть членом API/auth/vendor/worker`,
        );
      }
      break;
  }
  return errors;
}
