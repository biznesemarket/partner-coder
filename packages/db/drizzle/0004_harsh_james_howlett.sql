CREATE INDEX "auth_sessions_expires_idx" ON "auth_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "device_tokens_expires_idx" ON "device_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "auth_verifications_expires_idx" ON "auth_verifications" USING btree ("expires_at");--> statement-breakpoint

-- M2.3: retention сырых heartbeat. Append-only остается правилом по умолчанию:
-- DELETE разрешен только SECURITY DEFINER-функции, принадлежащей отдельной
-- роли partner_coder_retention, и только для heartbeats старше cutoff.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'partner_coder_retention') THEN
    CREATE ROLE partner_coder_retention NOLOGIN;
  END IF;
END
$$;--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO partner_coder_retention;--> statement-breakpoint
GRANT SELECT, DELETE ON TABLE heartbeats TO partner_coder_retention;--> statement-breakpoint

ALTER TABLE heartbeats ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE heartbeats FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS heartbeats_retention ON heartbeats;--> statement-breakpoint
CREATE POLICY heartbeats_retention ON heartbeats
  AS PERMISSIVE FOR DELETE TO partner_coder_retention
  USING (true);--> statement-breakpoint
DROP POLICY IF EXISTS heartbeats_retention_select ON heartbeats;--> statement-breakpoint
CREATE POLICY heartbeats_retention_select ON heartbeats
  AS PERMISSIVE FOR SELECT TO partner_coder_retention
  USING (true);--> statement-breakpoint

CREATE OR REPLACE FUNCTION reject_append_only_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND TG_TABLE_NAME = 'heartbeats'
     AND current_user = 'partner_coder_retention'
     AND coalesce(current_setting('app.retention', true), '') = 'on' THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'append_only_violation: % is append-only', TG_TABLE_NAME
    USING ERRCODE = '23514',
          HINT = 'Создайте компенсирующую запись вместо изменения или удаления';
END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION retention_delete_heartbeats(p_before timestamptz)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted bigint;
BEGIN
  IF p_before IS NULL OR p_before > now() THEN
    RAISE EXCEPTION 'retention_cutoff_invalid: cutoff должен быть в прошлом'
      USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('app.retention', 'on', true);
  DELETE FROM heartbeats WHERE received_at < p_before;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  PERFORM set_config('app.retention', 'off', true);
  RETURN v_deleted;
END
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION retention_delete_heartbeats(timestamptz) FROM PUBLIC;--> statement-breakpoint
ALTER FUNCTION retention_delete_heartbeats(timestamptz) OWNER TO partner_coder_retention;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION retention_delete_heartbeats(timestamptz) TO partner_coder_worker;