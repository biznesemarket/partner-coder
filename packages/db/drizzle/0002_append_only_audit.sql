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
    'vendor_audit_events'
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

-- Канонизация с версией и префиксами длин: границы полей не зависят от
-- символов-разделителей внутри action/entity.
CREATE OR REPLACE FUNCTION audit_event_hash(
  p_scope text,
  p_seq bigint,
  p_id uuid,
  p_actor uuid,
  p_actor_type text,
  p_action text,
  p_entity text,
  p_context text,
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
          'v2',
          length(p_scope), p_scope,
          p_seq,
          p_id,
          length(coalesce(p_actor::text, '')), coalesce(p_actor::text, ''),
          length(p_actor_type), p_actor_type,
          length(p_action), p_action,
          length(p_entity), p_entity,
          length(coalesce(p_context, '')), coalesce(p_context, ''),
          length(coalesce(p_before::text, '')), coalesce(p_before::text, ''),
          length(coalesce(p_after::text, '')), coalesce(p_after::text, ''),
          length(coalesce(p_ip::text, '')), coalesce(p_ip::text, ''),
          to_char(p_created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
          length(coalesce(p_prev_hash, '')), coalesce(p_prev_hash, '')
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
  v_seq bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('audit:' || NEW.tenant_id::text, 0));

  SELECT coalesce(max(chain_seq), 0) + 1 INTO v_seq
    FROM tenant_audit_events
   WHERE tenant_id = NEW.tenant_id;

  SELECT hash INTO v_prev
    FROM tenant_audit_events
   WHERE tenant_id = NEW.tenant_id
   ORDER BY chain_seq DESC
   LIMIT 1;

  NEW.created_at := clock_timestamp();
  NEW.chain_seq := v_seq;
  NEW.prev_hash := v_prev;
  NEW.hash := audit_event_hash(
    NEW.tenant_id::text,
    NEW.chain_seq,
    NEW.id,
    NEW.actor,
    NEW.actor_type::text,
    NEW.action,
    NEW.entity,
    '',
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
  v_seq bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('audit:vendor', 0));

  SELECT coalesce(max(chain_seq), 0) + 1 INTO v_seq FROM vendor_audit_events;

  SELECT hash INTO v_prev
    FROM vendor_audit_events
   ORDER BY chain_seq DESC
   LIMIT 1;

  NEW.created_at := clock_timestamp();
  NEW.chain_seq := v_seq;
  NEW.prev_hash := v_prev;
  NEW.hash := audit_event_hash(
    'vendor',
    NEW.chain_seq,
    NEW.id,
    NEW.actor_id,
    'vendor',
    NEW.action,
    NEW.entity,
    coalesce(NEW.customer_id::text, ''),
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
     ORDER BY chain_seq ASC
  LOOP
    IF r.prev_hash IS DISTINCT FROM v_prev THEN
      RETURN false;
    END IF;
    v_expected := audit_event_hash(
      r.tenant_id::text,
      r.chain_seq,
      r.id,
      r.actor,
      r.actor_type::text,
      r.action,
      r.entity,
      '',
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
  FOR r IN SELECT * FROM vendor_audit_events ORDER BY chain_seq ASC
  LOOP
    IF r.prev_hash IS DISTINCT FROM v_prev THEN
      RETURN false;
    END IF;
    v_expected := audit_event_hash(
      'vendor',
      r.chain_seq,
      r.id,
      r.actor_id,
      'vendor',
      r.action,
      r.entity,
      coalesce(r.customer_id::text, ''),
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

-- Якоря — производные снимки: их можно пересчитать (upsert), цепочка при
-- этом остается неизменяемой. Счетчик и последний хеш берутся одним запросом
-- под тем же advisory lock, что и вставка событий.
CREATE OR REPLACE FUNCTION anchor_tenant_audit(p_tenant_id uuid, p_date date)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_hash text;
  v_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('audit:' || p_tenant_id::text, 0));

  SELECT count(*)::integer,
         (SELECT e.hash
            FROM tenant_audit_events e
           WHERE e.tenant_id = p_tenant_id
             AND e.created_at >= (p_date::timestamp AT TIME ZONE 'UTC')
             AND e.created_at < ((p_date + 1)::timestamp AT TIME ZONE 'UTC')
           ORDER BY e.chain_seq DESC
           LIMIT 1)
    INTO v_count, v_hash
    FROM tenant_audit_events
   WHERE tenant_id = p_tenant_id
     AND created_at >= (p_date::timestamp AT TIME ZONE 'UTC')
     AND created_at < ((p_date + 1)::timestamp AT TIME ZONE 'UTC');

  IF v_count = 0 THEN
    RETURN NULL;
  END IF;

  INSERT INTO tenant_audit_anchors (tenant_id, date, last_hash, event_count)
  VALUES (p_tenant_id, p_date, v_hash, v_count)
  ON CONFLICT (tenant_id, date) DO UPDATE
    SET last_hash = excluded.last_hash,
        event_count = excluded.event_count,
        anchored_at = now();

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
  PERFORM pg_advisory_xact_lock(hashtextextended('audit:vendor', 0));

  SELECT count(*)::integer,
         (SELECT e.hash
            FROM vendor_audit_events e
           WHERE e.created_at >= (p_date::timestamp AT TIME ZONE 'UTC')
             AND e.created_at < ((p_date + 1)::timestamp AT TIME ZONE 'UTC')
           ORDER BY e.chain_seq DESC
           LIMIT 1)
    INTO v_count, v_hash
    FROM vendor_audit_events
   WHERE created_at >= (p_date::timestamp AT TIME ZONE 'UTC')
     AND created_at < ((p_date + 1)::timestamp AT TIME ZONE 'UTC');

  IF v_count = 0 THEN
    RETURN NULL;
  END IF;

  INSERT INTO vendor_audit_anchors (date, last_hash, event_count)
  VALUES (p_date, v_hash, v_count)
  ON CONFLICT (date) DO UPDATE
    SET last_hash = excluded.last_hash,
        event_count = excluded.event_count,
        anchored_at = now();

  RETURN v_hash;
END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION verify_tenant_audit_anchor(p_tenant_id uuid, p_date date)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM tenant_audit_anchors a
     WHERE a.tenant_id = p_tenant_id
       AND a.date = p_date
       AND a.event_count = (
         SELECT count(*)::integer
           FROM tenant_audit_events e
          WHERE e.tenant_id = p_tenant_id
            AND e.created_at >= (p_date::timestamp AT TIME ZONE 'UTC')
            AND e.created_at < ((p_date + 1)::timestamp AT TIME ZONE 'UTC')
       )
       AND a.last_hash = (
         SELECT e.hash
           FROM tenant_audit_events e
          WHERE e.tenant_id = p_tenant_id
            AND e.created_at >= (p_date::timestamp AT TIME ZONE 'UTC')
            AND e.created_at < ((p_date + 1)::timestamp AT TIME ZONE 'UTC')
          ORDER BY e.chain_seq DESC
          LIMIT 1
       )
  )
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
  vendor_audit_events
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
  tenant_audit_events
FROM partner_coder_api;--> statement-breakpoint

REVOKE UPDATE, DELETE ON TABLE vendor_audit_events
FROM partner_coder_vendor;--> statement-breakpoint
