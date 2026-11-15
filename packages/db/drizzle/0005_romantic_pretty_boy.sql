CREATE TABLE "auth_rate_limits" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"key" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "auth_rate_limits_count_chk" CHECK ("auth_rate_limits"."count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "email_rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"window_started_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "email_rate_limits_count_chk" CHECK ("email_rate_limits"."count" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "auth_rate_limits_key_uq" ON "auth_rate_limits" USING btree ("key");--> statement-breakpoint
CREATE INDEX "auth_rate_limits_last_request_idx" ON "auth_rate_limits" USING btree ("last_request");--> statement-breakpoint
CREATE INDEX "email_rate_limits_window_idx" ON "email_rate_limits" USING btree ("window_started_at");
-- Общий rate-limit store для нескольких API-инстансов (ADR-0012).
-- auth_rate_limits пишет только роль partner_coder_auth (Better Auth);
-- email_rate_limits — только роль API. Worker чистит обе таблицы по TTL.
ALTER TABLE auth_rate_limits ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE auth_rate_limits FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY auth_rate_limits_auth_all ON auth_rate_limits
  AS PERMISSIVE FOR ALL TO partner_coder_auth
  USING (true)
  WITH CHECK (true);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE auth_rate_limits TO partner_coder_auth;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE auth_rate_limits TO partner_coder_worker;--> statement-breakpoint

ALTER TABLE email_rate_limits ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE email_rate_limits FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY email_rate_limits_api_all ON email_rate_limits
  AS PERMISSIVE FOR ALL TO partner_coder_api
  USING (true)
  WITH CHECK (true);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE email_rate_limits TO partner_coder_api;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE email_rate_limits TO partner_coder_worker;
