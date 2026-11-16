CREATE TABLE "vendor_auth_accounts" (
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
CREATE TABLE "vendor_auth_email_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"window_started_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "vendor_auth_email_limits_count_chk" CHECK ("vendor_auth_email_limits"."count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "vendor_auth_passkeys" (
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
	CONSTRAINT "vendor_auth_passkeys_counter_chk" CHECK ("vendor_auth_passkeys"."counter" >= 0)
);
--> statement-breakpoint
CREATE TABLE "vendor_auth_rate_limits" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"key" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "vendor_auth_rate_limits_count_chk" CHECK ("vendor_auth_rate_limits"."count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "vendor_auth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"ip_address" "inet",
	"user_agent" text,
	"step_up_until" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_auth_two_factors" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" uuid NOT NULL,
	"verified" boolean DEFAULT true NOT NULL,
	"failed_verification_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp (3) with time zone,
	CONSTRAINT "vendor_auth_two_factors_failed_chk" CHECK ("vendor_auth_two_factors"."failed_verification_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "vendor_auth_verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vendor_users" ADD COLUMN "email_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "vendor_users" ADD COLUMN "image" text;--> statement-breakpoint
ALTER TABLE "vendor_auth_accounts" ADD CONSTRAINT "vendor_auth_accounts_user_id_vendor_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."vendor_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_auth_passkeys" ADD CONSTRAINT "vendor_auth_passkeys_user_id_vendor_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."vendor_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_auth_sessions" ADD CONSTRAINT "vendor_auth_sessions_user_id_vendor_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."vendor_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_auth_two_factors" ADD CONSTRAINT "vendor_auth_two_factors_user_id_vendor_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."vendor_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_auth_accounts_provider_account_uq" ON "vendor_auth_accounts" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "vendor_auth_accounts_user_idx" ON "vendor_auth_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "vendor_auth_email_limits_window_idx" ON "vendor_auth_email_limits" USING btree ("window_started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_auth_passkeys_credential_uq" ON "vendor_auth_passkeys" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "vendor_auth_passkeys_user_idx" ON "vendor_auth_passkeys" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_auth_rate_limits_key_uq" ON "vendor_auth_rate_limits" USING btree ("key");--> statement-breakpoint
CREATE INDEX "vendor_auth_rate_limits_last_request_idx" ON "vendor_auth_rate_limits" USING btree ("last_request");--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_auth_sessions_token_uq" ON "vendor_auth_sessions" USING btree ("token");--> statement-breakpoint
CREATE INDEX "vendor_auth_sessions_user_idx" ON "vendor_auth_sessions" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE INDEX "vendor_auth_sessions_expires_idx" ON "vendor_auth_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "vendor_auth_two_factors_user_idx" ON "vendor_auth_two_factors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "vendor_auth_verifications_identifier_idx" ON "vendor_auth_verifications" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "vendor_auth_verifications_expires_idx" ON "vendor_auth_verifications" USING btree ("expires_at");