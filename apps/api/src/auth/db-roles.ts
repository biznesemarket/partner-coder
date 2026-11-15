export type DbRoleScope = "api" | "auth";

export interface RoleFacts {
  readonly currentUser: string;
  readonly isSuperuser: boolean;
  readonly bypassRls: boolean;
  readonly authMember: boolean;
  readonly apiMember: boolean;
  readonly vendorMember: boolean;
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
    workerMember: row.worker_member,
  };
}

/**
 * Проверяет, что подключения API и Better Auth не пересекаются и не являются
 * суперпользователем/BYPASSRLS. Возвращает список проблем; пусто — все хорошо.
 */
export function roleSeparationErrors(scope: DbRoleScope, facts: RoleFacts): string[] {
  const errors: string[] = [];
  if (facts.isSuperuser) {
    errors.push(`${facts.currentUser}: суперпользователь недопустим для ${scope}`);
  }
  if (facts.bypassRls) {
    errors.push(`${facts.currentUser}: BYPASSRLS недопустим для ${scope}`);
  }
  if (scope === "auth") {
    if (!facts.authMember) {
      errors.push(`${facts.currentUser}: нужна роль partner_coder_auth`);
    }
    if (facts.apiMember || facts.vendorMember || facts.workerMember) {
      errors.push(`${facts.currentUser}: auth-логин не должен быть членом API/vendor/worker`);
    }
  } else {
    if (!facts.apiMember) {
      errors.push(`${facts.currentUser}: нужна роль partner_coder_api`);
    }
    if (facts.authMember || facts.vendorMember || facts.workerMember) {
      errors.push(`${facts.currentUser}: API-логин не должен быть членом auth/vendor/worker`);
    }
  }
  return errors;
}
