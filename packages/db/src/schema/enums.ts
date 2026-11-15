import { pgEnum } from "drizzle-orm/pg-core";

export const vendorRole = pgEnum("vendor_role", ["superadmin", "finance", "support", "readonly"]);
export const vendorUserStatus = pgEnum("vendor_user_status", [
  "invited",
  "active",
  "suspended",
  "disabled",
]);
export const customerStatus = pgEnum("customer_status", [
  "lead",
  "trial",
  "active",
  "grace",
  "suspended",
  "expired",
  "churned",
]);
export const billingPeriod = pgEnum("billing_period", ["month", "quarter", "year"]);
export const contractStatus = pgEnum("contract_status", ["draft", "active", "ended", "terminated"]);
export const subscriptionStatus = pgEnum("subscription_status", [
  "trial",
  "active",
  "grace",
  "expired",
  "suspended",
  "cancelled",
]);
export const invoiceStatus = pgEnum("invoice_status", [
  "draft",
  "issued",
  "paid",
  "partial",
  "overdue",
  "void",
]);
export const paymentMethod = pgEnum("payment_method", ["bank_transfer", "card", "cash", "other"]);
export const provisioningPackageStatus = pgEnum("provisioning_package_status", [
  "issued",
  "downloaded",
  "activated",
  "expired",
  "revoked",
]);
export const onboardingState = pgEnum("onboarding_state", [
  "issued",
  "downloaded",
  "enrolled",
  "profile",
  "git",
  "policy",
  "team",
  "active",
  "blocked",
]);
export const userStatus = pgEnum("user_status", ["invited", "active", "suspended", "deleted"]);
export const tenantStatus = pgEnum("tenant_status", [
  "onboarding",
  "active",
  "suspended",
  "archived",
]);
export const membershipRole = pgEnum("membership_role", [
  "director",
  "developer",
  "finance",
  "support",
]);
export const membershipStatus = pgEnum("membership_status", [
  "invited",
  "active",
  "paused",
  "good_leaver",
  "bad_leaver",
  "disabled",
]);
export const projectStatus = pgEnum("project_status", ["active", "paused", "archived"]);
export const forge = pgEnum("forge", ["github", "gitlab", "gitea", "forgejo"]);
export const intervalClass = pgEnum("interval_class", [
  "active_human",
  "supervised_agent",
  "autonomous_agent",
  "idle",
]);
export const intervalSource = pgEnum("interval_source", ["agent", "ide", "manual"]);
export const workSessionStatus = pgEnum("work_session_status", ["active", "ended", "abandoned"]);
export const adjustmentSource = pgEnum("adjustment_source", [
  "recalc",
  "late_event",
  "dispute",
  "manual",
]);
export const disputeStatus = pgEnum("dispute_status", [
  "open",
  "accepted",
  "rejected",
  "resolved",
  "expired",
]);
export const payoutStatus = pgEnum("payout_status", ["draft", "approved", "paid", "cancelled"]);
export const deviceStatus = pgEnum("device_status", ["pending", "active", "revoked"]);
export const invitationStatus = pgEnum("invitation_status", [
  "pending",
  "accepted",
  "expired",
  "revoked",
]);
export const integrationStatus = pgEnum("integration_status", ["active", "disabled", "error"]);
export const repoFactKind = pgEnum("repo_fact_kind", [
  "commit",
  "pull_request",
  "push",
  "branch",
  "review",
]);
export const notificationChannel = pgEnum("notification_channel", [
  "email",
  "telegram",
  "in_app",
  "agent",
]);
export const notificationStatus = pgEnum("notification_status", [
  "pending",
  "sent",
  "failed",
  "cancelled",
]);
export const digestStatus = pgEnum("digest_status", ["pending", "rendered", "sent", "failed"]);
export const auditActorType = pgEnum("audit_actor_type", ["user", "vendor", "system", "agent"]);
export const idempotencyStatus = pgEnum("idempotency_status", ["in_progress", "completed"]);
