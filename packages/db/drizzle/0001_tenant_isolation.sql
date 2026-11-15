-- Роли, контекст tenant и RLS для тенантского контура.
-- Логины (LOGIN) создаются отдельно при провижининге окружения и получают
-- членство в одной из ролей ниже.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'partner_coder_api') THEN
    CREATE ROLE partner_coder_api NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'partner_coder_vendor') THEN
    CREATE ROLE partner_coder_vendor NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'partner_coder_worker') THEN
    CREATE ROLE partner_coder_worker NOLOGIN BYPASSRLS;
  END IF;
END
$$;--> statement-breakpoint

ALTER ROLE partner_coder_worker BYPASSRLS;--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_current_tenant_id() RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('app.tenant_id', true), '')::uuid
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO partner_coder_api, partner_coder_vendor, partner_coder_worker;--> statement-breakpoint

-- tenants: строка доступна только своему tenant_id.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_self ON tenants;--> statement-breakpoint
CREATE POLICY tenant_self ON tenants
  AS PERMISSIVE FOR ALL TO partner_coder_api
  USING (id = app_current_tenant_id())
  WITH CHECK (id = app_current_tenant_id());--> statement-breakpoint

-- Все остальные тенантские таблицы используют общий tenant_id.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'memberships',
    'projects',
    'project_members',
    'policies',
    'rate_versions',
    'valuation_versions',
    'work_sessions',
    'heartbeats',
    'intervals',
    'day_records',
    'day_adjustments',
    'day_flags',
    'disputes',
    'payout_batches',
    'payout_items',
    'devices',
    'invitations',
    'git_integrations',
    'connector_events',
    'repo_facts',
    'notifications',
    'digest_runs',
    'monthly_snapshots',
    'tenant_audit_events',
    'tenant_audit_anchors'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tbl);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I AS PERMISSIVE FOR ALL TO partner_coder_api USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id())',
      tbl
    );
  END LOOP;
END
$$;--> statement-breakpoint

-- users: глобальная таблица, но API видит только участников своего tenant.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE users FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS users_tenant_read ON users;--> statement-breakpoint
CREATE POLICY users_tenant_read ON users
  AS PERMISSIVE FOR SELECT TO partner_coder_api
  USING (
    id = app_current_user_id()
    OR EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.user_id = users.id AND m.tenant_id = app_current_tenant_id()
    )
  );--> statement-breakpoint
DROP POLICY IF EXISTS users_insert_self ON users;--> statement-breakpoint
CREATE POLICY users_insert_self ON users
  AS PERMISSIVE FOR INSERT TO partner_coder_api
  WITH CHECK (id = app_current_user_id());--> statement-breakpoint
DROP POLICY IF EXISTS users_self_update ON users;--> statement-breakpoint
CREATE POLICY users_self_update ON users
  AS PERMISSIVE FOR UPDATE TO partner_coder_api
  USING (id = app_current_user_id())
  WITH CHECK (id = app_current_user_id());--> statement-breakpoint

-- auth_sessions: сессия доступна только своему пользователю.
ALTER TABLE auth_sessions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE auth_sessions FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS auth_session_self ON auth_sessions;--> statement-breakpoint
CREATE POLICY auth_session_self ON auth_sessions
  AS PERMISSIVE FOR ALL TO partner_coder_api
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());--> statement-breakpoint

-- idempotency_keys: tenant-ключи изолированы, vendor-ключи (tenant_id IS NULL)
-- доступны только вендорской роли.
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE idempotency_keys FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS idempotency_tenant ON idempotency_keys;--> statement-breakpoint
CREATE POLICY idempotency_tenant ON idempotency_keys
  AS PERMISSIVE FOR ALL TO partner_coder_api
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());--> statement-breakpoint
DROP POLICY IF EXISTS idempotency_vendor ON idempotency_keys;--> statement-breakpoint
CREATE POLICY idempotency_vendor ON idempotency_keys
  AS PERMISSIVE FOR ALL TO partner_coder_vendor
  USING (tenant_id IS NULL)
  WITH CHECK (tenant_id IS NULL);--> statement-breakpoint

-- Аутентификация: точечные SECURITY DEFINER-функции вместо выдачи API
-- широкого доступа к users/auth_sessions. Функции возвращают минимум полей.
CREATE OR REPLACE FUNCTION auth_user_by_email(p_email text)
RETURNS TABLE (id uuid, email text, name text, status user_status)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id, u.email, u.name, u.status
    FROM users u
   WHERE lower(u.email) = lower(p_email)
   LIMIT 1
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION auth_session_by_token(p_token_hash text)
RETURNS TABLE (
  session_id uuid,
  user_id uuid,
  expires_at timestamptz,
  revoked_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT s.id, s.user_id, s.expires_at, s.revoked_at
    FROM auth_sessions s
   WHERE s.token_hash = p_token_hash
   LIMIT 1
$$;--> statement-breakpoint

-- Аудит: API пишет события только через функцию, actor берется из контекста.
CREATE OR REPLACE FUNCTION app_audit(
  p_action text,
  p_entity text,
  p_before jsonb DEFAULT NULL,
  p_after jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := app_current_tenant_id();
  v_user uuid := app_current_user_id();
  v_id uuid := gen_random_uuid();
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'tenant_context_required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO tenant_audit_events
    (id, tenant_id, actor, actor_type, action, entity, before, after, ip)
  VALUES
    (v_id,
     v_tenant,
     v_user,
     CASE WHEN v_user IS NULL THEN 'system'::audit_actor_type ELSE 'user'::audit_actor_type END,
     p_action,
     p_entity,
     p_before,
     p_after,
     inet_client_addr());

  RETURN v_id;
END
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION auth_user_by_email(text) FROM PUBLIC;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION auth_session_by_token(text) FROM PUBLIC;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app_audit(text, text, jsonb, jsonb) FROM PUBLIC;--> statement-breakpoint
ALTER FUNCTION auth_user_by_email(text) OWNER TO partner_coder_worker;--> statement-breakpoint
ALTER FUNCTION auth_session_by_token(text) OWNER TO partner_coder_worker;--> statement-breakpoint
ALTER FUNCTION app_audit(text, text, jsonb, jsonb) OWNER TO partner_coder_worker;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_user_by_email(text) TO partner_coder_api;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_session_by_token(text) TO partner_coder_api;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_audit(text, text, jsonb, jsonb) TO partner_coder_api;--> statement-breakpoint

-- Права API: изменяемые таблицы — CRUD, журналы — только SELECT/INSERT.
GRANT SELECT, INSERT, UPDATE (name, locale, last_login_at) ON TABLE users TO partner_coder_api;--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  auth_sessions,
  memberships,
  projects,
  project_members,
  policies,
  rate_versions,
  valuation_versions,
  work_sessions,
  disputes,
  payout_batches,
  payout_items,
  devices,
  invitations,
  git_integrations,
  notifications,
  digest_runs,
  idempotency_keys
TO partner_coder_api;--> statement-breakpoint

GRANT SELECT ON TABLE tenants TO partner_coder_api;--> statement-breakpoint
GRANT UPDATE (name, timezone, settings) ON TABLE tenants TO partner_coder_api;--> statement-breakpoint

GRANT SELECT, INSERT ON TABLE
  heartbeats,
  intervals,
  connector_events,
  repo_facts
TO partner_coder_api;--> statement-breakpoint

GRANT SELECT ON TABLE
  day_records,
  day_adjustments,
  day_flags,
  monthly_snapshots,
  tenant_audit_events,
  tenant_audit_anchors
TO partner_coder_api;--> statement-breakpoint

-- Права вендора: только вендорский контур и вендорский журнал.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  vendor_users,
  customers,
  plans,
  contracts,
  subscriptions,
  invoices,
  payments,
  provisioning_packages,
  onboarding_sessions,
  idempotency_keys
TO partner_coder_vendor;--> statement-breakpoint

GRANT SELECT, INSERT ON TABLE vendor_audit_events TO partner_coder_vendor;--> statement-breakpoint
GRANT SELECT ON TABLE vendor_audit_anchors TO partner_coder_vendor;--> statement-breakpoint

-- Worker обслуживает все tenant-ы и обходит RLS как доверенный процесс.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO partner_coder_worker;--> statement-breakpoint
