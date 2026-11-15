-- Append-only журналы и хеш-цепочка аудита.

CREATE OR REPLACE FUNCTION reject_append_only_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'append_only_violation: % is append-only', TG_TABLE_NAME
    USING ERRCODE = '23514',
          HINT = 'Создайте компенсирующую запись вместо изменения или удаления';
END
$$;--> statement-breakpoint

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'heartbeats',
    'intervals',
    'day_records',
    'day_adjustments',
    'day_flags',
    'connector_events',
    'repo_facts',
    'monthly_snapshots',
    'tenant_audit_events',
    'tenant_audit_anchors',
    'vendor_audit_events',
    'vendor_audit_anchors'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', tbl || '_append_only', tbl);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation()',
      tbl || '_append_only', tbl
    );
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', tbl || '_append_only_truncate', tbl);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION reject_append_only_mutation()',
      tbl || '_append_only_truncate', tbl
    );
  END LOOP;
END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION audit_event_hash(
  p_scope text,
  p_id uuid,
  p_actor uuid,
  p_actor_type text,
  p_action text,
  p_entity text,
  p_before jsonb,
  p_after jsonb,
  p_ip inet,
  p_created_at timestamptz,
  p_prev_hash text
) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT encode(
    sha256(
      convert_to(
        concat_ws(
          '|',
          p_scope,
          p_id::text,
          coalesce(p_actor::text, ''),
          p_actor_type,
          p_action,
          p_entity,
          coalesce(p_before::text, ''),
          coalesce(p_after::text, ''),
          coalesce(p_ip::text, ''),
          to_char(p_created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
          coalesce(p_prev_hash, '')
        ),
        'UTF8'
      )
    ),
    'hex'
  )
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION tenant_audit_chain() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_prev text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text, 0));
  SELECT e.hash INTO v_prev
    FROM tenant_audit_events e
   WHERE e.tenant_id = NEW.tenant_id
   ORDER BY e.created_at DESC, e.id DESC
   LIMIT 1;
  NEW.created_at := clock_timestamp();
  NEW.prev_hash := v_prev;
  NEW.hash := audit_event_hash(
    NEW.tenant_id::text,
    NEW.id,
    NEW.actor,
    NEW.actor_type::text,
    NEW.action,
    NEW.entity,
    NEW.before,
    NEW.after,
    NEW.ip,
    NEW.created_at,
    v_prev
  );
  RETURN NEW;
END
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS tenant_audit_events_chain ON tenant_audit_events;--> statement-breakpoint
CREATE TRIGGER tenant_audit_events_chain
  BEFORE INSERT ON tenant_audit_events
  FOR EACH ROW EXECUTE FUNCTION tenant_audit_chain();--> statement-breakpoint

CREATE OR REPLACE FUNCTION vendor_audit_chain() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_prev text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('vendor_audit', 0));
  SELECT e.hash INTO v_prev
    FROM vendor_audit_events e
   ORDER BY e.created_at DESC, e.id DESC
   LIMIT 1;
  NEW.created_at := clock_timestamp();
  NEW.prev_hash := v_prev;
  NEW.hash := audit_event_hash(
    'vendor',
    NEW.id,
    NEW.actor_id,
    'vendor',
    NEW.action,
    NEW.entity,
    NEW.before,
    NEW.after,
    NEW.ip,
    NEW.created_at,
    v_prev
  );
  RETURN NEW;
END
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS vendor_audit_events_chain ON vendor_audit_events;--> statement-breakpoint
CREATE TRIGGER vendor_audit_events_chain
  BEFORE INSERT ON vendor_audit_events
  FOR EACH ROW EXECUTE FUNCTION vendor_audit_chain();--> statement-breakpoint

CREATE OR REPLACE FUNCTION verify_tenant_audit_chain(p_tenant_id uuid) RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  r record;
  v_prev text;
  v_expected text;
BEGIN
  v_prev := NULL;
  FOR r IN
    SELECT * FROM tenant_audit_events
     WHERE tenant_id = p_tenant_id
     ORDER BY created_at ASC, id ASC
  LOOP
    IF r.prev_hash IS DISTINCT FROM v_prev THEN
      RETURN false;
    END IF;
    v_expected := audit_event_hash(
      r.tenant_id::text,
      r.id,
      r.actor,
      r.actor_type::text,
      r.action,
      r.entity,
      r.before,
      r.after,
      r.ip,
      r.created_at,
      r.prev_hash
    );
    IF r.hash <> v_expected THEN
      RETURN false;
    END IF;
    v_prev := r.hash;
  END LOOP;
  RETURN true;
END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION verify_vendor_audit_chain() RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  r record;
  v_prev text;
  v_expected text;
BEGIN
  v_prev := NULL;
  FOR r IN SELECT * FROM vendor_audit_events ORDER BY created_at ASC, id ASC
  LOOP
    IF r.prev_hash IS DISTINCT FROM v_prev THEN
      RETURN false;
    END IF;
    v_expected := audit_event_hash(
      'vendor',
      r.id,
      r.actor_id,
      'vendor',
      r.action,
      r.entity,
      r.before,
      r.after,
      r.ip,
      r.created_at,
      r.prev_hash
    );
    IF r.hash <> v_expected THEN
      RETURN false;
    END IF;
    v_prev := r.hash;
  END LOOP;
  RETURN true;
END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION anchor_tenant_audit(p_tenant_id uuid, p_date date)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_hash text;
  v_count integer;
BEGIN
  SELECT count(*)::integer INTO v_count
    FROM tenant_audit_events
   WHERE tenant_id = p_tenant_id
     AND created_at >= (p_date::timestamp AT TIME ZONE 'UTC')
     AND created_at < ((p_date + 1)::timestamp AT TIME ZONE 'UTC');

  IF v_count = 0 THEN
    RETURN NULL;
  END IF;

  SELECT hash INTO v_hash
    FROM tenant_audit_events
   WHERE tenant_id = p_tenant_id
     AND created_at >= (p_date::timestamp AT TIME ZONE 'UTC')
     AND created_at < ((p_date + 1)::timestamp AT TIME ZONE 'UTC')
   ORDER BY created_at DESC, id DESC
   LIMIT 1;

  INSERT INTO tenant_audit_anchors (tenant_id, date, last_hash, event_count)
  VALUES (p_tenant_id, p_date, v_hash, v_count)
  ON CONFLICT (tenant_id, date) DO NOTHING;

  RETURN v_hash;
END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION anchor_vendor_audit(p_date date)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_hash text;
  v_count integer;
BEGIN
  SELECT count(*)::integer INTO v_count
    FROM vendor_audit_events
   WHERE created_at >= (p_date::timestamp AT TIME ZONE 'UTC')
     AND created_at < ((p_date + 1)::timestamp AT TIME ZONE 'UTC');

  IF v_count = 0 THEN
    RETURN NULL;
  END IF;

  SELECT hash INTO v_hash
    FROM vendor_audit_events
   WHERE created_at >= (p_date::timestamp AT TIME ZONE 'UTC')
     AND created_at < ((p_date + 1)::timestamp AT TIME ZONE 'UTC')
   ORDER BY created_at DESC, id DESC
   LIMIT 1;

  INSERT INTO vendor_audit_anchors (date, last_hash, event_count)
  VALUES (p_date, v_hash, v_count)
  ON CONFLICT (date) DO NOTHING;

  RETURN v_hash;
END
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION anchor_tenant_audit(uuid, date) FROM PUBLIC;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION anchor_vendor_audit(date) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION anchor_tenant_audit(uuid, date) TO partner_coder_worker;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION anchor_vendor_audit(date) TO partner_coder_worker;--> statement-breakpoint

REVOKE UPDATE, DELETE ON TABLE
  heartbeats,
  intervals,
  day_records,
  day_adjustments,
  day_flags,
  connector_events,
  repo_facts,
  monthly_snapshots,
  tenant_audit_events,
  tenant_audit_anchors,
  vendor_audit_events,
  vendor_audit_anchors
FROM partner_coder_worker;--> statement-breakpoint

REVOKE UPDATE, DELETE ON TABLE
  heartbeats,
  intervals,
  day_records,
  day_adjustments,
  day_flags,
  connector_events,
  repo_facts,
  monthly_snapshots,
  tenant_audit_events,
  tenant_audit_anchors
FROM partner_coder_api;--> statement-breakpoint

REVOKE UPDATE, DELETE ON TABLE vendor_audit_events, vendor_audit_anchors
FROM partner_coder_vendor;--> statement-breakpoint
