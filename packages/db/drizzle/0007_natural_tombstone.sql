CREATE TABLE "subscription_discounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"percent_bp" integer NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_discounts_percent_chk" CHECK ("subscription_discounts"."percent_bp" between 1000 and 5000),
	CONSTRAINT "subscription_discounts_period_chk" CHECK ("subscription_discounts"."ends_on" is null or "subscription_discounts"."ends_on" >= "subscription_discounts"."starts_on")
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "status_changed_at" timestamp (3) with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_discounts" ADD CONSTRAINT "subscription_discounts_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_discounts" ADD CONSTRAINT "subscription_discounts_created_by_vendor_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."vendor_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subscription_discounts_subscription_idx" ON "subscription_discounts" USING btree ("subscription_id","starts_on");--> statement-breakpoint
CREATE INDEX "subscriptions_status_idx" ON "subscriptions" USING btree ("status");--> statement-breakpoint
-- Скидки входят в вендорский контур: tenant-роли и API их не видят.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE subscription_discounts TO partner_coder_vendor;
