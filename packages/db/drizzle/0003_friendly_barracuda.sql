CREATE TABLE "device_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"device_id" uuid,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"scope" text DEFAULT 'agent' NOT NULL,
	"label" text,
	"expires_at" timestamp (3) with time zone,
	"revoked_at" timestamp (3) with time zone,
	"rotated_from" uuid,
	"last_used_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_tokens_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "device_tokens_hash_chk" CHECK ("device_tokens"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "device_tokens_prefix_chk" CHECK (length("device_tokens"."token_prefix") between 4 and 16),
	CONSTRAINT "device_tokens_scope_chk" CHECK (length("device_tokens"."scope") between 1 and 32)
);
--> statement-breakpoint
CREATE TABLE "auth_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp (3) with time zone,
	"refresh_token_expires_at" timestamp (3) with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_passkeys" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"public_key" text NOT NULL,
	"user_id" uuid NOT NULL,
	"credential_id" text NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean DEFAULT false NOT NULL,
	"transports" text,
	"aaguid" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_passkeys_counter_chk" CHECK ("auth_passkeys"."counter" >= 0)
);
--> statement-breakpoint
CREATE TABLE "auth_two_factors" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" uuid NOT NULL,
	"verified" boolean DEFAULT true NOT NULL,
	"failed_verification_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp (3) with time zone,
	CONSTRAINT "auth_two_factors_failed_chk" CHECK ("auth_two_factors"."failed_verification_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "auth_verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "auth_sessions_token_uq";--> statement-breakpoint
ALTER TABLE "auth_sessions" ALTER COLUMN "token_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD COLUMN "token" text;--> statement-breakpoint
UPDATE "auth_sessions" SET "token" = "token_hash" WHERE "token" IS NULL;--> statement-breakpoint
ALTER TABLE "auth_sessions" ALTER COLUMN "token" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD COLUMN "active_tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD COLUMN "updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "image" text;--> statement-breakpoint
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_membership_tenant_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_device_tenant_fk" FOREIGN KEY ("tenant_id","device_id") REFERENCES "public"."devices"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_rotated_tenant_fk" FOREIGN KEY ("tenant_id","rotated_from") REFERENCES "public"."device_tokens"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_passkeys" ADD CONSTRAINT "auth_passkeys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_two_factors" ADD CONSTRAINT "auth_two_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "device_tokens_hash_uq" ON "device_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "device_tokens_membership_idx" ON "device_tokens" USING btree ("membership_id","revoked_at");--> statement-breakpoint
CREATE INDEX "device_tokens_tenant_idx" ON "device_tokens" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_accounts_provider_account_uq" ON "auth_accounts" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "auth_accounts_user_idx" ON "auth_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_passkeys_user_idx" ON "auth_passkeys" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_passkeys_credential_uq" ON "auth_passkeys" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "auth_two_factors_user_idx" ON "auth_two_factors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_two_factors_secret_idx" ON "auth_two_factors" USING btree ("secret");--> statement-breakpoint
CREATE INDEX "auth_verifications_identifier_idx" ON "auth_verifications" USING btree ("identifier");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_membership_fk" FOREIGN KEY ("tenant_id","recipient_user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_sessions_legacy_token_uq" ON "auth_sessions" USING btree ("token_hash") WHERE "auth_sessions"."token_hash" is not null;--> statement-breakpoint
CREATE INDEX "auth_sessions_active_tenant_idx" ON "auth_sessions" USING btree ("active_tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_sessions_token_uq" ON "auth_sessions" USING btree ("token");-- M2.2: глобальный контур аутентификации. Better Auth работает под отдельной
-- ролью, у которой нет доступа к тенантским данным; API-роль не видит секреты.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'partner_coder_auth') THEN
    CREATE ROLE partner_coder_auth NOLOGIN;
  END IF;
END
$$;--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO partner_coder_auth;--> statement-breakpoint

ALTER TABLE users ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE users FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS users_auth_all ON users;--> statement-breakpoint
CREATE POLICY users_auth_all ON users
  AS PERMISSIVE FOR ALL TO partner_coder_auth
  USING (true)
  WITH CHECK (true);--> statement-breakpoint

ALTER TABLE auth_sessions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE auth_sessions FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS auth_sessions_auth_all ON auth_sessions;--> statement-breakpoint
CREATE POLICY auth_sessions_auth_all ON auth_sessions
  AS PERMISSIVE FOR ALL TO partner_coder_auth
  USING (true)
  WITH CHECK (true);--> statement-breakpoint

ALTER TABLE auth_accounts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE auth_accounts FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY auth_accounts_auth_all ON auth_accounts
  AS PERMISSIVE FOR ALL TO partner_coder_auth
  USING (true)
  WITH CHECK (true);--> statement-breakpoint

ALTER TABLE auth_verifications ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE auth_verifications FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY auth_verifications_auth_all ON auth_verifications
  AS PERMISSIVE FOR ALL TO partner_coder_auth
  USING (true)
  WITH CHECK (true);--> statement-breakpoint

ALTER TABLE auth_two_factors ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE auth_two_factors FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY auth_two_factors_auth_all ON auth_two_factors
  AS PERMISSIVE FOR ALL TO partner_coder_auth
  USING (true)
  WITH CHECK (true);--> statement-breakpoint

ALTER TABLE auth_passkeys ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE auth_passkeys FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY auth_passkeys_auth_all ON auth_passkeys
  AS PERMISSIVE FOR ALL TO partner_coder_auth
  USING (true)
  WITH CHECK (true);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  users,
  auth_sessions,
  auth_accounts,
  auth_verifications,
  auth_two_factors,
  auth_passkeys
TO partner_coder_auth;--> statement-breakpoint

ALTER TABLE device_tokens ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE device_tokens FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON device_tokens
  AS PERMISSIVE FOR ALL TO partner_coder_api
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE device_tokens TO partner_coder_api;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE device_tokens TO partner_coder_worker;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  auth_accounts,
  auth_verifications,
  auth_two_factors,
  auth_passkeys
TO partner_coder_worker;--> statement-breakpoint

-- Членства пользователя нужны API до выбора tenant: RLS-контекст еще не задан.
CREATE OR REPLACE FUNCTION auth_user_memberships(p_user_id uuid)
RETURNS TABLE (
  membership_id uuid,
  tenant_id uuid,
  role membership_role,
  status membership_status,
  tenant_name text,
  tenant_slug text,
  tenant_timezone text,
  joined_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT m.id, m.tenant_id, m.role, m.status, t.name, t.slug, t.timezone, m.joined_at
    FROM memberships m
    JOIN tenants t ON t.id = m.tenant_id
   WHERE m.user_id = p_user_id
   ORDER BY m.created_at, m.id
$$;--> statement-breakpoint

-- Agent/device-токен аутентифицируется до установки tenant-контекста.
CREATE OR REPLACE FUNCTION auth_device_by_token_hash(p_token_hash text)
RETURNS TABLE (
  token_id uuid,
  tenant_id uuid,
  membership_id uuid,
  user_id uuid,
  membership_role membership_role,
  membership_status membership_status,
  user_status user_status,
  scope text,
  expires_at timestamptz,
  revoked_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT dt.id, dt.tenant_id, dt.membership_id, m.user_id, m.role, m.status, u.status,
         dt.scope, dt.expires_at, dt.revoked_at
    FROM device_tokens dt
    JOIN memberships m ON m.id = dt.membership_id AND m.tenant_id = dt.tenant_id
    JOIN users u ON u.id = m.user_id
   WHERE dt.token_hash = p_token_hash
   LIMIT 1
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION auth_invitation_by_token_hash(p_token_hash text)
RETURNS TABLE (
  invitation_id uuid,
  tenant_id uuid,
  email text,
  role membership_role,
  status invitation_status,
  expires_at timestamptz,
  tenant_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT i.id, i.tenant_id, i.email, i.role, i.status, i.expires_at, t.name
    FROM invitations i
    JOIN tenants t ON t.id = i.tenant_id
   WHERE i.token_hash = p_token_hash
   LIMIT 1
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION auth_user_memberships(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION auth_device_by_token_hash(text) FROM PUBLIC;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION auth_invitation_by_token_hash(text) FROM PUBLIC;--> statement-breakpoint
ALTER FUNCTION auth_user_memberships(uuid) OWNER TO partner_coder_worker;--> statement-breakpoint
ALTER FUNCTION auth_device_by_token_hash(text) OWNER TO partner_coder_worker;--> statement-breakpoint
ALTER FUNCTION auth_invitation_by_token_hash(text) OWNER TO partner_coder_worker;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_user_memberships(uuid) TO partner_coder_api;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_device_by_token_hash(text) TO partner_coder_api;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_invitation_by_token_hash(text) TO partner_coder_api;--> statement-breakpoint

