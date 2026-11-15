CREATE TYPE "public"."adjustment_source" AS ENUM('recalc', 'late_event', 'dispute', 'manual');--> statement-breakpoint
CREATE TYPE "public"."audit_actor_type" AS ENUM('user', 'vendor', 'system', 'agent');--> statement-breakpoint
CREATE TYPE "public"."billing_period" AS ENUM('month', 'quarter', 'year');--> statement-breakpoint
CREATE TYPE "public"."contract_status" AS ENUM('draft', 'active', 'ended', 'terminated');--> statement-breakpoint
CREATE TYPE "public"."customer_status" AS ENUM('lead', 'trial', 'active', 'grace', 'suspended', 'expired', 'churned');--> statement-breakpoint
CREATE TYPE "public"."device_status" AS ENUM('pending', 'active', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."digest_status" AS ENUM('pending', 'rendered', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."dispute_status" AS ENUM('open', 'accepted', 'rejected', 'resolved', 'expired');--> statement-breakpoint
CREATE TYPE "public"."forge" AS ENUM('github', 'gitlab', 'gitea', 'forgejo');--> statement-breakpoint
CREATE TYPE "public"."idempotency_status" AS ENUM('in_progress', 'completed');--> statement-breakpoint
CREATE TYPE "public"."integration_status" AS ENUM('active', 'disabled', 'error');--> statement-breakpoint
CREATE TYPE "public"."interval_class" AS ENUM('active_human', 'supervised_agent', 'autonomous_agent', 'idle');--> statement-breakpoint
CREATE TYPE "public"."interval_source" AS ENUM('agent', 'ide', 'manual');--> statement-breakpoint
CREATE TYPE "public"."invitation_status" AS ENUM('pending', 'accepted', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'issued', 'paid', 'partial', 'overdue', 'void');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('director', 'developer', 'finance', 'support');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('invited', 'active', 'paused', 'good_leaver', 'bad_leaver', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('email', 'telegram', 'in_app', 'agent');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('pending', 'sent', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."onboarding_state" AS ENUM('issued', 'downloaded', 'enrolled', 'profile', 'git', 'policy', 'team', 'active', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('bank_transfer', 'card', 'cash', 'other');--> statement-breakpoint
CREATE TYPE "public"."payout_status" AS ENUM('draft', 'approved', 'paid', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('active', 'paused', 'archived');--> statement-breakpoint
CREATE TYPE "public"."provisioning_package_status" AS ENUM('issued', 'downloaded', 'activated', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."repo_fact_kind" AS ENUM('commit', 'pull_request', 'push', 'branch', 'review');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('trial', 'active', 'grace', 'expired', 'suspended', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."tenant_status" AS ENUM('onboarding', 'active', 'suspended', 'archived');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('invited', 'active', 'suspended', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."vendor_role" AS ENUM('superadmin', 'finance', 'support', 'readonly');--> statement-breakpoint
CREATE TYPE "public"."vendor_user_status" AS ENUM('invited', 'active', 'suspended', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."work_session_status" AS ENUM('active', 'ended', 'abandoned');--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"number" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "contract_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contracts_period_chk" CHECK ("contracts"."ends_on" is null or "contracts"."ends_on" >= "contracts"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legal_name" text NOT NULL,
	"inn" text,
	"kpp" text,
	"contact" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "customer_status" DEFAULT 'lead' NOT NULL,
	"notes" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_inn_format_chk" CHECK ("customers"."inn" is null or "customers"."inn" ~ '^[0-9]{10,12}$'),
	CONSTRAINT "customers_kpp_format_chk" CHECK ("customers"."kpp" is null or "customers"."kpp" ~ '^[0-9]{9}$')
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"number" text NOT NULL,
	"issued_on" date NOT NULL,
	"due_on" date NOT NULL,
	"amount_kopecks" bigint NOT NULL,
	"status" "invoice_status" DEFAULT 'draft' NOT NULL,
	"pdf_url" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_due_chk" CHECK ("invoices"."due_on" >= "invoices"."issued_on"),
	CONSTRAINT "invoices_amount_chk" CHECK ("invoices"."amount_kopecks" >= 0)
);
--> statement-breakpoint
CREATE TABLE "onboarding_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"package_id" uuid NOT NULL,
	"state" "onboarding_state" DEFAULT 'issued' NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"progress_bp" integer DEFAULT 0 NOT NULL,
	"blocked_reason" text,
	"last_activity_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_sessions_progress_chk" CHECK ("onboarding_sessions"."progress_bp" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"paid_on" date NOT NULL,
	"amount_kopecks" bigint NOT NULL,
	"method" "payment_method" DEFAULT 'bank_transfer' NOT NULL,
	"reference" text,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount_chk" CHECK ("payments"."amount_kopecks" > 0)
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"price_kopecks" bigint NOT NULL,
	"period" "billing_period" DEFAULT 'month' NOT NULL,
	"seats_limit" integer NOT NULL,
	"projects_limit" integer NOT NULL,
	"features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_price_chk" CHECK ("plans"."price_kopecks" >= 0),
	CONSTRAINT "plans_seats_chk" CHECK ("plans"."seats_limit" >= 1),
	CONSTRAINT "plans_projects_chk" CHECK ("plans"."projects_limit" >= 1)
);
--> statement-breakpoint
CREATE TABLE "provisioning_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"version" text NOT NULL,
	"checksum" text,
	"status" "provisioning_package_status" DEFAULT 'issued' NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"activated_at" timestamp (3) with time zone,
	"activated_ip" "inet",
	"created_by" uuid,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"status" "subscription_status" DEFAULT 'trial' NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"grace_until" timestamp (3) with time zone,
	"seats" integer NOT NULL,
	"projects_limit" integer NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_period_chk" CHECK ("subscriptions"."period_end" >= "subscriptions"."period_start"),
	CONSTRAINT "subscriptions_seats_chk" CHECK ("subscriptions"."seats" >= 1),
	CONSTRAINT "subscriptions_projects_chk" CHECK ("subscriptions"."projects_limit" >= 1)
);
--> statement-breakpoint
CREATE TABLE "vendor_audit_anchors" (
	"date" date PRIMARY KEY NOT NULL,
	"last_hash" text NOT NULL,
	"event_count" integer NOT NULL,
	"anchored_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_audit_anchors_count_chk" CHECK ("vendor_audit_anchors"."event_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "vendor_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"customer_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"ip" "inet",
	"prev_hash" text,
	"hash" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "vendor_role" DEFAULT 'support' NOT NULL,
	"status" "vendor_user_status" DEFAULT 'invited' NOT NULL,
	"mfa_enabled" boolean DEFAULT false NOT NULL,
	"last_login_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"ip" "inet",
	"user_agent" text,
	"revoked_at" timestamp (3) with time zone,
	"last_seen_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"public_key" text NOT NULL,
	"name" text NOT NULL,
	"os" text NOT NULL,
	"status" "device_status" DEFAULT 'pending' NOT NULL,
	"last_seen" timestamp (3) with time zone,
	"revoked_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "membership_role" DEFAULT 'developer' NOT NULL,
	"token_hash" text NOT NULL,
	"status" "invitation_status" DEFAULT 'pending' NOT NULL,
	"invited_by" uuid,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"accepted_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_email_chk" CHECK ("invitations"."email" ~ '^[^@[:space:]]+@[^@[:space:]]+$')
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "membership_role" DEFAULT 'developer' NOT NULL,
	"status" "membership_status" DEFAULT 'invited' NOT NULL,
	"display_name" text,
	"joined_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"timezone" text DEFAULT 'Europe/Moscow' NOT NULL,
	"status" "tenant_status" DEFAULT 'onboarding' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_format_chk" CHECK ("tenants"."slug" ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
	CONSTRAINT "tenants_timezone_len_chk" CHECK (length("tenants"."timezone") between 1 and 64)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"auth_provider" text DEFAULT 'magic_link' NOT NULL,
	"status" "user_status" DEFAULT 'invited' NOT NULL,
	"locale" text DEFAULT 'ru-RU' NOT NULL,
	"last_login_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "day_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"day_record_id" uuid NOT NULL,
	"delta_kopecks" bigint NOT NULL,
	"reason" text NOT NULL,
	"source" "adjustment_source" DEFAULT 'recalc' NOT NULL,
	"input_hash" text NOT NULL,
	"approved_by" uuid,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "day_adjustments_reason_chk" CHECK (length("day_adjustments"."reason") >= 5),
	CONSTRAINT "day_adjustments_input_hash_chk" CHECK ("day_adjustments"."input_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "day_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"day_record_id" uuid NOT NULL,
	"code" text NOT NULL,
	"detail" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "day_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"date_local" date NOT NULL,
	"timezone" text NOT NULL,
	"paid_seconds" integer NOT NULL,
	"tracked_seconds" integer DEFAULT 0 NOT NULL,
	"classes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"amount_kopecks" bigint NOT NULL,
	"cash_kopecks" bigint NOT NULL,
	"equity_kopecks" bigint NOT NULL,
	"share_bp" bigint NOT NULL,
	"pool_used_bp" integer DEFAULT 0 NOT NULL,
	"pool_pending" boolean DEFAULT false NOT NULL,
	"pending_equity_kopecks" bigint NOT NULL,
	"versions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"input_hash" text NOT NULL,
	"explanation" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"closed_at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "day_records_paid_seconds_chk" CHECK ("day_records"."paid_seconds" >= 0),
	CONSTRAINT "day_records_tracked_seconds_chk" CHECK ("day_records"."tracked_seconds" >= 0),
	CONSTRAINT "day_records_amount_chk" CHECK ("day_records"."amount_kopecks" >= 0),
	CONSTRAINT "day_records_cash_chk" CHECK ("day_records"."cash_kopecks" >= 0),
	CONSTRAINT "day_records_equity_chk" CHECK ("day_records"."equity_kopecks" >= 0),
	CONSTRAINT "day_records_split_chk" CHECK ("day_records"."cash_kopecks" + "day_records"."equity_kopecks" = "day_records"."amount_kopecks"),
	CONSTRAINT "day_records_share_chk" CHECK ("day_records"."share_bp" >= 0),
	CONSTRAINT "day_records_pool_used_chk" CHECK ("day_records"."pool_used_bp" >= 0),
	CONSTRAINT "day_records_input_hash_chk" CHECK ("day_records"."input_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"day_record_id" uuid NOT NULL,
	"opened_by" uuid,
	"reason" text NOT NULL,
	"interval_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "dispute_status" DEFAULT 'open' NOT NULL,
	"deadline" timestamp (3) with time zone NOT NULL,
	"resolution" text,
	"delta_kopecks" bigint,
	"resolved_by" uuid,
	"resolved_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "disputes_reason_chk" CHECK (length("disputes"."reason") >= 5)
);
--> statement-breakpoint
CREATE TABLE "heartbeats" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"class" interval_class NOT NULL,
	"start_utc" timestamp (3) with time zone NOT NULL,
	"end_utc" timestamp (3) with time zone NOT NULL,
	"client_time" timestamp (3) with time zone,
	"received_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"signals" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"signature_valid" boolean DEFAULT false NOT NULL,
	"late" boolean DEFAULT false NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "heartbeats_period_chk" CHECK ("heartbeats"."end_utc" > "heartbeats"."start_utc"),
	CONSTRAINT "heartbeats_seq_chk" CHECK ("heartbeats"."seq" >= 0)
);
--> statement-breakpoint
CREATE TABLE "intervals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"class" interval_class NOT NULL,
	"start_utc" timestamp (3) with time zone NOT NULL,
	"end_utc" timestamp (3) with time zone NOT NULL,
	"seconds" integer NOT NULL,
	"source" interval_source DEFAULT 'agent' NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "intervals_period_chk" CHECK ("intervals"."end_utc" > "intervals"."start_utc"),
	CONSTRAINT "intervals_seconds_chk" CHECK ("intervals"."seconds" >= 0)
);
--> statement-breakpoint
CREATE TABLE "monthly_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"month" date NOT NULL,
	"sha256" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monthly_snapshots_month_chk" CHECK ("monthly_snapshots"."month" = date_trunc('month', "monthly_snapshots"."month")::date),
	CONSTRAINT "monthly_snapshots_sha256_chk" CHECK ("monthly_snapshots"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "payout_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"period" text NOT NULL,
	"status" "payout_status" DEFAULT 'draft' NOT NULL,
	"created_by" uuid,
	"paid_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payout_batches_period_chk" CHECK ("payout_batches"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
CREATE TABLE "payout_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"amount_kopecks" bigint NOT NULL,
	"method" "payment_method" DEFAULT 'bank_transfer' NOT NULL,
	"reference" text,
	"paid_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payout_items_amount_chk" CHECK ("payout_items"."amount_kopecks" >= 0)
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"params" jsonb NOT NULL,
	"effective_from" timestamp (3) with time zone NOT NULL,
	"approved_by" uuid,
	"sha256" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policies_version_chk" CHECK ("policies"."version" >= 1),
	CONSTRAINT "policies_sha256_chk" CHECK ("policies"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"role" "membership_role" DEFAULT 'developer' NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_members_pk" PRIMARY KEY("project_id","membership_id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"forge" "forge" DEFAULT 'github' NOT NULL,
	"repo" text NOT NULL,
	"default_branch" text DEFAULT 'main' NOT NULL,
	"timezone" text DEFAULT 'Europe/Moscow' NOT NULL,
	"status" "project_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_repo_len_chk" CHECK (length("projects"."repo") between 1 and 255)
);
--> statement-breakpoint
CREATE TABLE "rate_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"effective_from" timestamp (3) with time zone NOT NULL,
	"value_kopecks" bigint NOT NULL,
	"reason" text NOT NULL,
	"approved_by" uuid,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_versions_value_chk" CHECK ("rate_versions"."value_kopecks" > 0),
	CONSTRAINT "rate_versions_reason_chk" CHECK (length("rate_versions"."reason") >= 5)
);
--> statement-breakpoint
CREATE TABLE "valuation_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"effective_from" timestamp (3) with time zone NOT NULL,
	"value_kopecks" bigint NOT NULL,
	"reason" text NOT NULL,
	"approved_by" uuid,
	"adr_ref" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "valuation_versions_value_chk" CHECK ("valuation_versions"."value_kopecks" > 0),
	CONSTRAINT "valuation_versions_reason_chk" CHECK (length("valuation_versions"."reason") >= 5),
	CONSTRAINT "valuation_versions_adr_chk" CHECK (length("valuation_versions"."adr_ref") >= 1)
);
--> statement-breakpoint
CREATE TABLE "work_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"device_id" uuid,
	"task_ref" text,
	"branch" text,
	"status" "work_session_status" DEFAULT 'active' NOT NULL,
	"started_at" timestamp (3) with time zone NOT NULL,
	"ended_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_sessions_period_chk" CHECK ("work_sessions"."ended_at" is null or "work_sessions"."ended_at" >= "work_sessions"."started_at")
);
--> statement-breakpoint
CREATE TABLE "connector_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" "forge" NOT NULL,
	"delivery_id" text NOT NULL,
	"event_type" text NOT NULL,
	"project_id" uuid,
	"payload_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"received_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "digest_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"date_local" date NOT NULL,
	"status" "digest_status" DEFAULT 'pending' NOT NULL,
	"rendered" jsonb,
	"sent_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "git_integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"provider" "forge" NOT NULL,
	"installation_id" text NOT NULL,
	"repo" text NOT NULL,
	"webhook_secret_hash" text NOT NULL,
	"status" "integration_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"recipient_user_id" uuid,
	"recipient" text NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"kind" text NOT NULL,
	"status" "notification_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp (3) with time zone,
	"sent_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_attempts_chk" CHECK ("notifications"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "repo_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" "repo_fact_kind" NOT NULL,
	"ref" text NOT NULL,
	"task_ref" text,
	"branch" text,
	"occurred_at" timestamp (3) with time zone NOT NULL,
	"payload_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repo_facts_ref_len_chk" CHECK (length("repo_facts"."ref") between 1 and 512)
);
--> statement-breakpoint
CREATE TABLE "tenant_audit_anchors" (
	"tenant_id" uuid NOT NULL,
	"date" date NOT NULL,
	"last_hash" text NOT NULL,
	"event_count" integer NOT NULL,
	"anchored_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_audit_anchors_count_chk" CHECK ("tenant_audit_anchors"."event_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "tenant_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor" uuid,
	"actor_type" "audit_actor_type" DEFAULT 'user' NOT NULL,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"ip" "inet",
	"prev_hash" text,
	"hash" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_audit_events_action_len_chk" CHECK (length("tenant_audit_events"."action") between 1 and 128),
	CONSTRAINT "tenant_audit_events_entity_len_chk" CHECK (length("tenant_audit_events"."entity") between 1 and 128)
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" "idempotency_status" DEFAULT 'in_progress' NOT NULL,
	"status_code" integer,
	"response" jsonb,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "idempotency_keys_scope_len_chk" CHECK (length("idempotency_keys"."scope") between 1 and 128),
	CONSTRAINT "idempotency_keys_key_len_chk" CHECK (length("idempotency_keys"."key") between 1 and 255),
	CONSTRAINT "idempotency_keys_request_hash_chk" CHECK (length("idempotency_keys"."request_hash") = 64),
	CONSTRAINT "idempotency_keys_status_code_chk" CHECK ("idempotency_keys"."status_code" is null or ("idempotency_keys"."status_code" between 100 and 599))
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_sessions" ADD CONSTRAINT "onboarding_sessions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_sessions" ADD CONSTRAINT "onboarding_sessions_package_id_provisioning_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."provisioning_packages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_vendor_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."vendor_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provisioning_packages" ADD CONSTRAINT "provisioning_packages_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provisioning_packages" ADD CONSTRAINT "provisioning_packages_created_by_vendor_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."vendor_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_audit_events" ADD CONSTRAINT "vendor_audit_events_actor_id_vendor_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."vendor_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_audit_events" ADD CONSTRAINT "vendor_audit_events_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_adjustments" ADD CONSTRAINT "day_adjustments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_adjustments" ADD CONSTRAINT "day_adjustments_day_record_id_day_records_id_fk" FOREIGN KEY ("day_record_id") REFERENCES "public"."day_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_adjustments" ADD CONSTRAINT "day_adjustments_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_flags" ADD CONSTRAINT "day_flags_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_flags" ADD CONSTRAINT "day_flags_day_record_id_day_records_id_fk" FOREIGN KEY ("day_record_id") REFERENCES "public"."day_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_records" ADD CONSTRAINT "day_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_records" ADD CONSTRAINT "day_records_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_records" ADD CONSTRAINT "day_records_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_day_record_id_day_records_id_fk" FOREIGN KEY ("day_record_id") REFERENCES "public"."day_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_opened_by_users_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heartbeats" ADD CONSTRAINT "heartbeats_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heartbeats" ADD CONSTRAINT "heartbeats_session_id_work_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."work_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intervals" ADD CONSTRAINT "intervals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intervals" ADD CONSTRAINT "intervals_session_id_work_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."work_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_snapshots" ADD CONSTRAINT "monthly_snapshots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_batches" ADD CONSTRAINT "payout_batches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_batches" ADD CONSTRAINT "payout_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_items" ADD CONSTRAINT "payout_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_items" ADD CONSTRAINT "payout_items_batch_id_payout_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."payout_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_items" ADD CONSTRAINT "payout_items_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_versions" ADD CONSTRAINT "rate_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_versions" ADD CONSTRAINT "rate_versions_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_versions" ADD CONSTRAINT "rate_versions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuation_versions" ADD CONSTRAINT "valuation_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuation_versions" ADD CONSTRAINT "valuation_versions_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuation_versions" ADD CONSTRAINT "valuation_versions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_events" ADD CONSTRAINT "connector_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_events" ADD CONSTRAINT "connector_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_runs" ADD CONSTRAINT "digest_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_integrations" ADD CONSTRAINT "git_integrations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_integrations" ADD CONSTRAINT "git_integrations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_facts" ADD CONSTRAINT "repo_facts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_facts" ADD CONSTRAINT "repo_facts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_audit_anchors" ADD CONSTRAINT "tenant_audit_anchors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_audit_events" ADD CONSTRAINT "tenant_audit_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_audit_events" ADD CONSTRAINT "tenant_audit_events_actor_users_id_fk" FOREIGN KEY ("actor") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contracts_number_uq" ON "contracts" USING btree ("number");--> statement-breakpoint
CREATE INDEX "contracts_customer_idx" ON "contracts" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_inn_uq" ON "customers" USING btree ("inn") WHERE "customers"."inn" is not null;--> statement-breakpoint
CREATE INDEX "customers_status_idx" ON "customers" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_number_uq" ON "invoices" USING btree ("number");--> statement-breakpoint
CREATE INDEX "invoices_customer_status_idx" ON "invoices" USING btree ("customer_id","status");--> statement-breakpoint
CREATE INDEX "onboarding_sessions_customer_idx" ON "onboarding_sessions" USING btree ("customer_id","state");--> statement-breakpoint
CREATE INDEX "payments_invoice_idx" ON "payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_code_uq" ON "plans" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "provisioning_packages_token_uq" ON "provisioning_packages" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "provisioning_packages_customer_idx" ON "provisioning_packages" USING btree ("customer_id","status");--> statement-breakpoint
CREATE INDEX "subscriptions_customer_idx" ON "subscriptions" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "vendor_audit_events_created_idx" ON "vendor_audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_audit_events_hash_uq" ON "vendor_audit_events" USING btree ("hash");--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_audit_events_prev_uq" ON "vendor_audit_events" USING btree ("prev_hash") WHERE "vendor_audit_events"."prev_hash" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_users_email_lower_uq" ON "vendor_users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "vendor_users_role_idx" ON "vendor_users" USING btree ("role");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_sessions_token_uq" ON "auth_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_idx" ON "auth_sessions" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_public_key_uq" ON "devices" USING btree ("public_key");--> statement-breakpoint
CREATE INDEX "devices_membership_idx" ON "devices" USING btree ("membership_id","status");--> statement-breakpoint
CREATE INDEX "devices_tenant_idx" ON "devices" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_uq" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invitations_tenant_email_idx" ON "invitations" USING btree ("tenant_id",lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_tenant_user_uq" ON "memberships" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "memberships_tenant_role_idx" ON "memberships" USING btree ("tenant_id","role");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_slug_uq" ON "tenants" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "tenants_customer_idx" ON "tenants" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_uq" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "day_adjustments_record_hash_uq" ON "day_adjustments" USING btree ("day_record_id","input_hash");--> statement-breakpoint
CREATE INDEX "day_adjustments_tenant_created_idx" ON "day_adjustments" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "day_flags_record_code_uq" ON "day_flags" USING btree ("day_record_id","code");--> statement-breakpoint
CREATE INDEX "day_flags_tenant_code_idx" ON "day_flags" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "day_records_tenant_project_member_date_uq" ON "day_records" USING btree ("tenant_id","project_id","membership_id","date_local");--> statement-breakpoint
CREATE INDEX "day_records_tenant_date_idx" ON "day_records" USING btree ("tenant_id","date_local");--> statement-breakpoint
CREATE INDEX "day_records_project_date_idx" ON "day_records" USING btree ("project_id","date_local");--> statement-breakpoint
CREATE INDEX "disputes_tenant_status_idx" ON "disputes" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "disputes_record_idx" ON "disputes" USING btree ("day_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "heartbeats_session_seq_uq" ON "heartbeats" USING btree ("session_id","seq");--> statement-breakpoint
CREATE INDEX "heartbeats_session_received_idx" ON "heartbeats" USING btree ("session_id","received_at");--> statement-breakpoint
CREATE INDEX "heartbeats_tenant_received_idx" ON "heartbeats" USING btree ("tenant_id","received_at");--> statement-breakpoint
CREATE INDEX "intervals_tenant_start_idx" ON "intervals" USING btree ("tenant_id","start_utc");--> statement-breakpoint
CREATE INDEX "intervals_session_start_idx" ON "intervals" USING btree ("session_id","start_utc");--> statement-breakpoint
CREATE UNIQUE INDEX "monthly_snapshots_tenant_month_uq" ON "monthly_snapshots" USING btree ("tenant_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "payout_batches_tenant_period_uq" ON "payout_batches" USING btree ("tenant_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX "payout_items_batch_member_uq" ON "payout_items" USING btree ("batch_id","membership_id");--> statement-breakpoint
CREATE INDEX "payout_items_tenant_idx" ON "payout_items" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "policies_project_version_uq" ON "policies" USING btree ("project_id","version");--> statement-breakpoint
CREATE INDEX "policies_tenant_effective_idx" ON "policies" USING btree ("tenant_id","effective_from");--> statement-breakpoint
CREATE INDEX "project_members_membership_idx" ON "project_members" USING btree ("membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_tenant_forge_repo_uq" ON "projects" USING btree ("tenant_id","forge","repo");--> statement-breakpoint
CREATE INDEX "projects_tenant_status_idx" ON "projects" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "rate_versions_policy_effective_uq" ON "rate_versions" USING btree ("policy_id","effective_from");--> statement-breakpoint
CREATE INDEX "rate_versions_tenant_idx" ON "rate_versions" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "valuation_versions_policy_effective_uq" ON "valuation_versions" USING btree ("policy_id","effective_from");--> statement-breakpoint
CREATE INDEX "valuation_versions_tenant_idx" ON "valuation_versions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "work_sessions_tenant_member_start_idx" ON "work_sessions" USING btree ("tenant_id","membership_id","started_at");--> statement-breakpoint
CREATE INDEX "work_sessions_project_start_idx" ON "work_sessions" USING btree ("project_id","started_at");--> statement-breakpoint
CREATE INDEX "work_sessions_status_idx" ON "work_sessions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "connector_events_delivery_uq" ON "connector_events" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX "connector_events_tenant_received_idx" ON "connector_events" USING btree ("tenant_id","received_at");--> statement-breakpoint
CREATE INDEX "connector_events_project_idx" ON "connector_events" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "digest_runs_tenant_date_uq" ON "digest_runs" USING btree ("tenant_id","date_local");--> statement-breakpoint
CREATE UNIQUE INDEX "git_integrations_project_provider_uq" ON "git_integrations" USING btree ("tenant_id","project_id","provider");--> statement-breakpoint
CREATE INDEX "git_integrations_tenant_status_idx" ON "git_integrations" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "notifications_status_next_idx" ON "notifications" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "notifications_tenant_created_idx" ON "notifications" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "repo_facts_project_branch_idx" ON "repo_facts" USING btree ("project_id","branch");--> statement-breakpoint
CREATE INDEX "repo_facts_project_task_idx" ON "repo_facts" USING btree ("project_id","task_ref");--> statement-breakpoint
CREATE INDEX "repo_facts_tenant_occurred_idx" ON "repo_facts" USING btree ("tenant_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_audit_anchors_tenant_date_uq" ON "tenant_audit_anchors" USING btree ("tenant_id","date");--> statement-breakpoint
CREATE INDEX "tenant_audit_events_tenant_created_idx" ON "tenant_audit_events" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_audit_events_tenant_hash_uq" ON "tenant_audit_events" USING btree ("tenant_id","hash");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_audit_events_tenant_prev_uq" ON "tenant_audit_events" USING btree ("tenant_id","prev_hash") WHERE "tenant_audit_events"."prev_hash" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_keys_owner_scope_key_uq" ON "idempotency_keys" USING btree (coalesce("tenant_id", '00000000-0000-0000-0000-000000000000'::uuid),"scope","key");--> statement-breakpoint
CREATE INDEX "idempotency_keys_expires_idx" ON "idempotency_keys" USING btree ("expires_at");