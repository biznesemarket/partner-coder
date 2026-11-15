export interface WorkerRoleFacts {
  readonly rolname: string;
  readonly rolsuper: boolean;
  readonly workerMember: boolean;
  readonly apiMember: boolean;
  readonly authMember: boolean;
}

export function workerRoleErrors(facts: WorkerRoleFacts): string[] {
  const errors: string[] = [];
  if (facts.rolsuper) {
    errors.push(`login ${facts.rolname}: worker не должен быть superuser`);
  }
  if (!facts.workerMember) {
    errors.push(`login ${facts.rolname}: нет членства partner_coder_worker`);
  }
  if (facts.apiMember) {
    errors.push(`login ${facts.rolname}: worker не должен входить в partner_coder_api`);
  }
  if (facts.authMember) {
    errors.push(`login ${facts.rolname}: worker не должен входить в partner_coder_auth`);
  }
  return errors;
}

interface RoleRow {
  readonly rolname: string;
  readonly rolsuper: boolean;
  readonly worker_member: boolean;
  readonly api_member: boolean;
  readonly auth_member: boolean;
}

export async function readWorkerRoleFacts(
  query: (sql: string) => Promise<{ rows: unknown[] }>,
): Promise<WorkerRoleFacts> {
  const result = await query(`
    select current_user as rolname, r.rolsuper,
           pg_has_role(current_user, 'partner_coder_worker', 'member') as worker_member,
           pg_has_role(current_user, 'partner_coder_api', 'member') as api_member,
           pg_has_role(current_user, 'partner_coder_auth', 'member') as auth_member
      from pg_roles r
     where r.rolname = current_user
  `);
  const row = result.rows[0] as RoleRow | undefined;
  if (!row) {
    throw new Error("Не удалось прочитать роль текущего login для worker");
  }
  return {
    rolname: row.rolname,
    rolsuper: row.rolsuper,
    workerMember: row.worker_member,
    apiMember: row.api_member,
    authMember: row.auth_member,
  };
}
