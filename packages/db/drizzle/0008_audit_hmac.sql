CREATE EXTENSION IF NOT EXISTS pgcrypto;--> statement-breakpoint

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
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_key text := current_setting('app.audit_hmac_key', true);
BEGIN
  IF v_key IS NULL OR v_key = '' THEN
    RAISE EXCEPTION 'audit_hmac_key_missing' USING ERRCODE = '42501';
  END IF;

  RETURN encode(
    hmac(
      convert_to(
        concat_ws(
          '|',
          'v3',
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
      ),
      convert_to(v_key, 'UTF8'),
      'sha256'::text
    ),
    'hex'
  );
END
$$;
