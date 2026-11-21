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

export const vendorContractStatusSchema = z.enum(["draft", "active", "ended", "terminated"]);

export const vendorContractLimitsSchema = z.record(
  z.string(),
  z.number().int().min(0).max(100_000),
);

export const vendorContractCreateSchema = z.object({
  customerId: z.uuid(),
  planId: z.uuid(),
  number: z.string().trim().min(1).max(64),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endsOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  limits: vendorContractLimitsSchema.optional(),
  status: vendorContractStatusSchema.default("draft"),
});

export const vendorContractSchema = z.object({
  id: z.uuid(),
  customerId: z.uuid(),
  planId: z.uuid(),
  number: z.string(),
  startsOn: z.string(),
  endsOn: z.string().nullable(),
  limits: vendorContractLimitsSchema,
  status: vendorContractStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const vendorContractResponseSchema = z.object({ contract: vendorContractSchema });

export const vendorContractListResponseSchema = z.object({ items: z.array(vendorContractSchema) });

export const vendorContractListQuerySchema = z.object({
  customerId: z.uuid().optional(),
  status: vendorContractStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const vendorSubscriptionStatusSchema = z.enum([
  "trial",
  "active",
  "grace",
  "expired",
  "suspended",
  "cancelled",
]);

export const vendorSubscriptionCreateSchema = z.object({
  customerId: z.uuid(),
  contractId: z.uuid(),
  status: vendorSubscriptionStatusSchema.default("trial"),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  seats: z.number().int().min(1).max(1000).optional(),
  projectsLimit: z.number().int().min(1).max(1000).optional(),
});

export const vendorSubscriptionSchema = z.object({
  id: z.uuid(),
  customerId: z.uuid(),
  contractId: z.uuid(),
  status: vendorSubscriptionStatusSchema,
  periodStart: z.string(),
  periodEnd: z.string(),
  graceUntil: z.string().nullable(),
  statusChangedAt: z.string(),
  seats: z.number().int(),
  projectsLimit: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const vendorSubscriptionResponseSchema = z.object({
  subscription: vendorSubscriptionSchema,
});

export const vendorSubscriptionListResponseSchema = z.object({
  items: z.array(vendorSubscriptionSchema),
});

export const vendorSubscriptionListQuerySchema = z.object({
  customerId: z.uuid().optional(),
  status: vendorSubscriptionStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const vendorSubscriptionRenewSchema = z
  .object({
    periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .refine((value) => value.periodEnd > value.periodStart, {
    message: "Дата окончания должна быть позже даты начала",
    path: ["periodEnd"],
  });

export const vendorSubscriptionStatusUpdateSchema = z.object({
  status: z.enum(["active", "grace", "expired"]),
  graceUntil: z.iso.datetime({ offset: true }).nullable().optional(),
  reason: z.string().trim().max(500).optional(),
});

export const vendorDiscountCreateSchema = z
  .object({
    percentBp: z.number().int().min(1000).max(5000),
    startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endsOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .refine(
    (value) =>
      value.endsOn === undefined || value.endsOn === null || value.endsOn >= value.startsOn,
    {
      message: "Дата окончания скидки должна быть не раньше начала",
      path: ["endsOn"],
    },
  );

export const vendorDiscountSchema = z.object({
  id: z.uuid(),
  subscriptionId: z.uuid(),
  percentBp: z.number().int(),
  startsOn: z.string(),
  endsOn: z.string().nullable(),
  note: z.string().nullable(),
  createdBy: z.uuid(),
  createdAt: z.string(),
});

export const vendorDiscountResponseSchema = z.object({ discount: vendorDiscountSchema });

export const vendorDiscountListResponseSchema = z.object({ items: z.array(vendorDiscountSchema) });

export const vendorInvoiceStatusSchema = z.enum([
  "draft",
  "issued",
  "paid",
  "partial",
  "overdue",
  "void",
]);

const kopecksSchema = z
  .string()
  .max(15)
  .regex(/^\d+$/, "Сумма в копейках должна быть целым числом");

const vendorPdfUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }, "Укажите ссылку http(s)");

export const vendorInvoiceCreateSchema = z
  .object({
    customerId: z.uuid(),
    contractId: z.uuid(),
    number: z.string().trim().min(1).max(64),
    issuedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    amountKopecks: kopecksSchema,
    status: vendorInvoiceStatusSchema.default("draft"),
    pdfUrl: vendorPdfUrlSchema.nullable().optional(),
  })
  .refine((value) => value.dueOn >= value.issuedOn, {
    message: "Срок оплаты не может быть раньше даты выставления",
    path: ["dueOn"],
  });

export const vendorInvoiceUpdateSchema = z.object({
  status: vendorInvoiceStatusSchema.optional(),
  pdfUrl: vendorPdfUrlSchema.nullable().optional(),
});

export const vendorInvoiceSchema = z.object({
  id: z.uuid(),
  customerId: z.uuid(),
  contractId: z.uuid(),
  number: z.string(),
  issuedOn: z.string(),
  dueOn: z.string(),
  amountKopecks: z.string(),
  status: vendorInvoiceStatusSchema,
  pdfUrl: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const vendorInvoiceResponseSchema = z.object({ invoice: vendorInvoiceSchema });

export const vendorInvoiceListResponseSchema = z.object({ items: z.array(vendorInvoiceSchema) });

export const vendorInvoiceListQuerySchema = z.object({
  customerId: z.uuid().optional(),
  status: vendorInvoiceStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const vendorPaymentMethodSchema = z.enum(["bank_transfer", "card", "cash", "other"]);

export const vendorPaymentCreateSchema = z.object({
  invoiceId: z.uuid(),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amountKopecks: kopecksSchema.refine((value) => value !== "0", {
    message: "Платёж должен быть больше нуля",
  }),
  method: vendorPaymentMethodSchema.default("bank_transfer"),
  reference: z.string().trim().max(200).nullable().optional(),
});

export const vendorPaymentSchema = z.object({
  id: z.uuid(),
  invoiceId: z.uuid(),
  invoiceNumber: z.string(),
  customerId: z.uuid(),
  customerLegalName: z.string(),
  paidOn: z.string(),
  amountKopecks: z.string(),
  method: vendorPaymentMethodSchema,
  reference: z.string().nullable(),
  recordedBy: z.uuid(),
  createdAt: z.string(),
});

export const vendorPaymentResponseSchema = z.object({ payment: vendorPaymentSchema });

export const vendorPaymentListResponseSchema = z.object({ items: z.array(vendorPaymentSchema) });

export const vendorPaymentListQuerySchema = z.object({
  invoiceId: z.uuid().optional(),
  customerId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const vendorCustomerSuspendSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export const vendorCustomerResumeSchema = z
  .object({
    periodStart: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    periodEnd: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((value) => (value.periodStart === undefined) === (value.periodEnd === undefined), {
    message: "Укажите обе даты периода или ни одной",
    path: ["periodStart"],
  })
  .refine((value) => value.periodEnd === undefined || value.periodEnd > value.periodStart!, {
    message: "Дата окончания должна быть позже даты начала",
    path: ["periodEnd"],
  });

export const vendorProvisioningPackageStatusSchema = z.enum([
  "issued",
  "downloaded",
  "activated",
  "expired",
  "revoked",
]);

export const vendorProvisioningPackageSchema = z.object({
  id: z.uuid(),
  customerId: z.uuid(),
  customerLegalName: z.string(),
  tokenPrefix: z.string(),
  version: z.string(),
  checksum: z.string().nullable(),
  status: vendorProvisioningPackageStatusSchema,
  expiresAt: z.string(),
  activatedAt: z.string().nullable(),
  activatedIp: z.string().nullable(),
  createdBy: z.uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const vendorProvisioningPackageIssueResponseSchema = z.object({
  package: vendorProvisioningPackageSchema,
  token: z.string(),
});

export const vendorProvisioningPackageListResponseSchema = z.object({
  items: z.array(vendorProvisioningPackageSchema),
});

export const vendorProvisioningPackageListQuerySchema = z.object({
  customerId: z.uuid().optional(),
  status: vendorProvisioningPackageStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const vendorProvisioningPackageReissueSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

const vendorDashboardGroupSchema = z.object({
  total: z.number().int(),
  byStatus: z.record(z.string(), z.number().int()),
});

export const vendorDashboardSchema = z.object({
  customers: vendorDashboardGroupSchema,
  subscriptions: vendorDashboardGroupSchema,
  invoices: vendorDashboardGroupSchema,
  packages: vendorDashboardGroupSchema,
  onboarding: z.object({
    total: z.number().int(),
    byState: z.record(z.string(), z.number().int()),
  }),
});
export type InvitationCreateInput = z.infer<typeof invitationCreateSchema>;
export type DeviceCreateInput = z.infer<typeof deviceCreateSchema>;
export type DaysQueryInput = z.infer<typeof daysQuerySchema>;
