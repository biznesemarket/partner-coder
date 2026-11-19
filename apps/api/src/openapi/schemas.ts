import { z } from "zod";

export const tenantRolesSchema = z.enum(["director", "developer", "finance", "support"]);

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.record(z.string(), z.unknown()).optional(),
    requestId: z.string().min(1),
  }),
});

export const healthResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  version: z.string(),
  uptimeSeconds: z.number().nonnegative(),
  checks: z.record(z.string(), z.enum(["ok", "fail", "skip"])),
});

export const readyResponseSchema = z.object({ status: z.enum(["ok", "degraded"]) });

export const tenantIdBodySchema = z.object({ tenantId: z.uuid() });

export const invitationCreateSchema = z.object({
  email: z.email(),
  role: tenantRolesSchema,
  ttlMinutes: z
    .number()
    .int()
    .min(5)
    .max(90 * 24 * 60)
    .optional(),
});

export const tokenParamsSchema = z.object({ token: z.string().min(10).max(256) });
export const invitationParamsSchema = z.object({ id: z.uuid() });
export const deviceParamsSchema = z.object({ id: z.uuid() });

export const deviceCreateSchema = z.object({
  label: z.string().trim().max(120).optional(),
  scope: z.enum(["agent", "mcp"]).default("agent"),
  ttlMinutes: z
    .number()
    .int()
    .min(5)
    .max(365 * 24 * 60)
    .optional(),
  deviceId: z.uuid().optional(),
});

export const daysQuerySchema = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  membershipId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const membershipSchema = z.object({
  membershipId: z.uuid(),
  tenantId: z.uuid(),
  tenantName: z.string(),
  tenantSlug: z.string(),
  role: tenantRolesSchema,
  status: z.enum(["invited", "active", "disabled"]),
});

export const authMeResponseSchema = z.object({
  user: z.object({
    id: z.uuid(),
    email: z.string().nullable(),
    name: z.string().nullable(),
    emailVerified: z.boolean(),
    kind: z.enum(["session", "device"]),
  }),
  activeTenantId: z.uuid().nullable(),
  memberships: z.array(membershipSchema),
});

export const tenantSwitchResponseSchema = z.object({
  activeTenantId: z.uuid(),
  membership: z.object({ membershipId: z.uuid(), role: tenantRolesSchema }),
});

export const invitationSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  role: tenantRolesSchema,
  status: z.string(),
  invitedBy: z.string().nullable(),
  expiresAt: z.string(),
  acceptedAt: z.string().nullable(),
  createdAt: z.string(),
});

export const invitationListResponseSchema = z.object({ items: z.array(invitationSchema) });

export const invitationCreateResponseSchema = z.object({
  id: z.uuid(),
  expiresAt: z.string(),
  inviteUrl: z.string(),
  token: z.string(),
});

export const publicInvitationResponseSchema = z.object({
  tenantName: z.string(),
  email: z.string(),
  role: tenantRolesSchema,
  status: z.string(),
  expiresAt: z.string(),
});

export const acceptInvitationResponseSchema = z.object({
  invitationId: z.uuid(),
  tenantId: z.uuid(),
  membershipId: z.uuid(),
  role: tenantRolesSchema,
});

export const deviceSchema = z.object({
  id: z.uuid(),
  tokenPrefix: z.string(),
  scope: z.string(),
  label: z.string().nullable(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  createdAt: z.string(),
});

export const deviceListResponseSchema = z.object({ items: z.array(deviceSchema) });

export const deviceIssuedResponseSchema = z.object({
  id: z.uuid(),
  token: z.string(),
  tokenPrefix: z.string(),
  expiresAt: z.string().nullable(),
});

export const tenantOverviewResponseSchema = z.object({
  tenantId: z.uuid(),
  members: z.number().int().nonnegative(),
  activeMembers: z.number().int().nonnegative(),
  projects: z.number().int().nonnegative(),
  closedDays: z.number().int().nonnegative(),
  lastClosedDay: z.string().nullable(),
});

export const tenantMemberSchema = z.object({
  membershipId: z.uuid(),
  userId: z.uuid(),
  email: z.string(),
  name: z.string(),
  role: tenantRolesSchema,
  status: z.enum(["invited", "active", "disabled"]),
  displayName: z.string().nullable(),
  joinedAt: z.string().nullable(),
});

export const tenantMembersResponseSchema = z.object({ items: z.array(tenantMemberSchema) });

export const tenantProjectSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  forge: z.string(),
  repo: z.string(),
  defaultBranch: z.string(),
  timezone: z.string(),
  status: z.string(),
});

export const tenantProjectsResponseSchema = z.object({ items: z.array(tenantProjectSchema) });

export const tenantDaySchema = z.object({
  id: z.uuid(),
  membershipId: z.uuid(),
  displayName: z.string().nullable(),
  dateLocal: z.string(),
  timezone: z.string(),
  paidSeconds: z.number().int().nonnegative(),
  amountKopecks: z.string(),
  cashKopecks: z.string(),
  equityKopecks: z.string(),
  shareBp: z.string(),
  poolPending: z.boolean(),
  closedAt: z.string(),
});

export const tenantDaysResponseSchema = z.object({ items: z.array(tenantDaySchema) });

export const vendorRolesSchema = z.enum(["superadmin", "finance", "support", "readonly"]);

export const vendorUserStatusesSchema = z.enum(["invited", "active", "suspended", "disabled"]);

export const vendorUserStatusUpdateSchema = z.enum(["active", "suspended", "disabled"]);

export const vendorUserSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  name: z.string(),
  emailVerified: z.boolean(),
  image: z.string().nullable(),
  role: vendorRolesSchema,
  status: vendorUserStatusesSchema,
  twoFactorEnabled: z.boolean(),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const vendorUserResponseSchema = z.object({ user: vendorUserSchema });

export const vendorUserListResponseSchema = z.object({ items: z.array(vendorUserSchema) });

export const vendorUserCreateSchema = z.object({
  email: z.email(),
  name: z.string().trim().min(1).max(120),
  role: vendorRolesSchema.default("support"),
  confirmSuperadmin: z.boolean().optional(),
});

export const vendorUserUpdateSchema = z.object({
  role: vendorRolesSchema.optional(),
  status: vendorUserStatusUpdateSchema.optional(),
  confirmSuperadmin: z.boolean().optional(),
});

export const vendorUserParamsSchema = z.object({ id: z.uuid() });

export const vendorAuthMeResponseSchema = z.object({
  user: z.object({
    id: z.uuid(),
    email: z.string(),
    name: z.string(),
    role: vendorRolesSchema,
    status: vendorUserStatusesSchema,
    twoFactorEnabled: z.boolean(),
  }),
  mfaEnrollmentRequired: z.boolean(),
  sessionExpiresAt: z.string(),
  stepUpUntil: z.string().nullable(),
});

export const vendorStepUpSchema = z.object({ password: z.string().min(1).max(128) });

export const vendorStepUpResponseSchema = z.object({ stepUpUntil: z.string() });

export const vendorPasswordResetResponseSchema = z.object({ status: z.literal(true) });

export const vendorMfaResetResponseSchema = z.object({
  twoFactors: z.number().int().nonnegative(),
  passkeys: z.number().int().nonnegative(),
  sessions: z.number().int().nonnegative(),
});

export const vendorIdParamsSchema = z.object({ id: z.uuid() });

export const vendorCustomerStatusSchema = z.enum([
  "lead",
  "trial",
  "active",
  "grace",
  "suspended",
  "expired",
  "churned",
]);

export const vendorCustomerContactSchema = z.object({
  name: z.string().trim().max(120).optional(),
  email: z.email().optional(),
  phone: z.string().trim().max(40).optional(),
  address: z.string().trim().max(300).optional(),
});

const innSchema = z
  .string()
  .trim()
  .regex(/^\d{10,12}$/, "ИНН должен содержать 10–12 цифр");
const kppSchema = z
  .string()
  .trim()
  .regex(/^\d{9}$/, "КПП должен содержать 9 цифр");

export const vendorCustomerCreateSchema = z.object({
  legalName: z.string().trim().min(1).max(200),
  inn: innSchema.nullable().optional(),
  kpp: kppSchema.nullable().optional(),
  contact: vendorCustomerContactSchema.optional(),
  status: vendorCustomerStatusSchema.default("lead"),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export const vendorCustomerUpdateSchema = z.object({
  legalName: z.string().trim().min(1).max(200).optional(),
  inn: innSchema.nullable().optional(),
  kpp: kppSchema.nullable().optional(),
  contact: vendorCustomerContactSchema.optional(),
  status: vendorCustomerStatusSchema.optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export const vendorCustomerSchema = z.object({
  id: z.uuid(),
  legalName: z.string(),
  inn: z.string().nullable(),
  kpp: z.string().nullable(),
  contact: vendorCustomerContactSchema,
  status: vendorCustomerStatusSchema,
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const vendorCustomerResponseSchema = z.object({
  customer: vendorCustomerSchema,
});

export const vendorCustomerListResponseSchema = z.object({
  items: z.array(vendorCustomerSchema),
});

export const vendorCustomerListQuerySchema = z.object({
  status: vendorCustomerStatusSchema.optional(),
  query: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const vendorBillingPeriodSchema = z.enum(["month", "quarter", "year"]);

export const vendorPlanFeaturesSchema = z.record(
  z.string(),
  z.union([z.boolean(), z.number(), z.string()]),
);

export const vendorPlanCreateSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9_-]{1,31}$/, "Код тарифа: строчные латинские буквы, цифры, _ и -"),
  name: z.string().trim().min(1).max(120),
  priceKopecks: z.string().regex(/^\d+$/, "Цена в копейках должна быть целым числом"),
  period: vendorBillingPeriodSchema.default("month"),
  seatsLimit: z.number().int().min(1).max(1000),
  projectsLimit: z.number().int().min(1).max(1000),
  features: vendorPlanFeaturesSchema.default({}),
  isActive: z.boolean().default(true),
});

export const vendorPlanUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  priceKopecks: z.string().regex(/^\d+$/).optional(),
  period: vendorBillingPeriodSchema.optional(),
  seatsLimit: z.number().int().min(1).max(1000).optional(),
  projectsLimit: z.number().int().min(1).max(1000).optional(),
  features: vendorPlanFeaturesSchema.optional(),
  isActive: z.boolean().optional(),
});

export const vendorPlanSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  priceKopecks: z.string(),
  period: vendorBillingPeriodSchema,
  seatsLimit: z.number().int(),
  projectsLimit: z.number().int(),
  features: vendorPlanFeaturesSchema,
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const vendorPlanResponseSchema = z.object({
  plan: vendorPlanSchema,
});

export const vendorPlanListResponseSchema = z.object({
  items: z.array(vendorPlanSchema),
});

export const vendorPlanListQuerySchema = z.object({
  activeOnly: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  query: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export type InvitationCreateInput = z.infer<typeof invitationCreateSchema>;
export type DeviceCreateInput = z.infer<typeof deviceCreateSchema>;
export type DaysQueryInput = z.infer<typeof daysQuerySchema>;
