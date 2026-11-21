const CUSTOMER_STATUSES = [
  "lead",
  "trial",
  "active",
  "grace",
  "suspended",
  "expired",
  "churned",
] as const;

const PLAN_PERIODS = ["month", "quarter", "year"] as const;

export type VendorCustomerStatus = (typeof CUSTOMER_STATUSES)[number];
export type VendorPlanPeriod = (typeof PLAN_PERIODS)[number];

export type VendorCustomerContact = {
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
};

export type VendorCustomer = {
  id: string;
  legalName: string;
  inn: string | null;
  kpp: string | null;
  contact: VendorCustomerContact;
  status: VendorCustomerStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type VendorPlan = {
  id: string;
  code: string;
  name: string;
  priceKopecks: string;
  period: VendorPlanPeriod;
  seatsLimit: number;
  projectsLimit: number;
  features: Record<string, boolean | number | string>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type VendorListResult<T> =
  { kind: "ok"; items: readonly T[] } | { kind: "unauthenticated" } | { kind: "error" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStatus(value: unknown): value is VendorCustomerStatus {
  return typeof value === "string" && (CUSTOMER_STATUSES as readonly string[]).includes(value);
}

function isPeriod(value: unknown): value is VendorPlanPeriod {
  return typeof value === "string" && (PLAN_PERIODS as readonly string[]).includes(value);
}

function parseContact(value: unknown): VendorCustomerContact {
  if (!isRecord(value)) {
    return {};
  }
  const contact: VendorCustomerContact = {};
  if (typeof value.name === "string") {
    contact.name = value.name;
  }
  if (typeof value.email === "string") {
    contact.email = value.email;
  }
  if (typeof value.phone === "string") {
    contact.phone = value.phone;
  }
  if (typeof value.address === "string") {
    contact.address = value.address;
  }
  return contact;
}

export function parseVendorCustomer(value: unknown): VendorCustomer | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.id !== "string" ||
    typeof value.legalName !== "string" ||
    (value.inn !== null && typeof value.inn !== "string") ||
    (value.kpp !== null && typeof value.kpp !== "string") ||
    !isStatus(value.status) ||
    (value.notes !== null && typeof value.notes !== "string") ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    return null;
  }

  return {
    id: value.id,
    legalName: value.legalName,
    inn: value.inn,
    kpp: value.kpp,
    contact: parseContact(value.contact),
    status: value.status,
    notes: value.notes,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

export function parseVendorCustomerList(value: unknown): readonly VendorCustomer[] | null {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    return null;
  }
  const items: VendorCustomer[] = [];
  for (const item of value.items) {
    const customer = parseVendorCustomer(item);
    if (!customer) {
      return null;
    }
    items.push(customer);
  }
  return items;
}

export function parseVendorPlan(value: unknown): VendorPlan | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.id !== "string" ||
    typeof value.code !== "string" ||
    typeof value.name !== "string" ||
    typeof value.priceKopecks !== "string" ||
    !isPeriod(value.period) ||
    typeof value.seatsLimit !== "number" ||
    typeof value.projectsLimit !== "number" ||
    !isRecord(value.features) ||
    typeof value.isActive !== "boolean" ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    return null;
  }

  return {
    id: value.id,
    code: value.code,
    name: value.name,
    priceKopecks: value.priceKopecks,
    period: value.period,
    seatsLimit: value.seatsLimit,
    projectsLimit: value.projectsLimit,
    features: value.features as Record<string, boolean | number | string>,
    isActive: value.isActive,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

export function parseVendorPlanList(value: unknown): readonly VendorPlan[] | null {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    return null;
  }
  const items: VendorPlan[] = [];
  for (const item of value.items) {
    const plan = parseVendorPlan(item);
    if (!plan) {
      return null;
    }
    items.push(plan);
  }
  return items;
}

const CONTRACT_STATUSES = ["draft", "active", "ended", "terminated"] as const;
const SUBSCRIPTION_STATUSES = [
  "trial",
  "active",
  "grace",
  "expired",
  "suspended",
  "cancelled",
] as const;
const INVOICE_STATUSES = ["draft", "issued", "paid", "partial", "overdue", "void"] as const;
const PAYMENT_METHODS = ["bank_transfer", "card", "cash", "other"] as const;

export type VendorContractStatus = (typeof CONTRACT_STATUSES)[number];
export type VendorSubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
export type VendorInvoiceStatus = (typeof INVOICE_STATUSES)[number];
export type VendorPaymentMethod = (typeof PAYMENT_METHODS)[number];

export type VendorContract = {
  id: string;
  customerId: string;
  planId: string;
  number: string;
  startsOn: string;
  endsOn: string | null;
  limits: Record<string, number>;
  status: VendorContractStatus;
  createdAt: string;
  updatedAt: string;
};

export type VendorSubscription = {
  id: string;
  customerId: string;
  contractId: string;
  status: VendorSubscriptionStatus;
  periodStart: string;
  periodEnd: string;
  graceUntil: string | null;
  statusChangedAt: string;
  seats: number;
  projectsLimit: number;
  createdAt: string;
  updatedAt: string;
};

export type VendorDiscount = {
  id: string;
  subscriptionId: string;
  percentBp: number;
  startsOn: string;
  endsOn: string | null;
  note: string | null;
  createdBy: string;
  createdAt: string;
};

export type VendorInvoice = {
  id: string;
  customerId: string;
  contractId: string;
  number: string;
  issuedOn: string;
  dueOn: string;
  amountKopecks: string;
  status: VendorInvoiceStatus;
  pdfUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type VendorPayment = {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  customerLegalName: string;
  paidOn: string;
  amountKopecks: string;
  method: VendorPaymentMethod;
  reference: string | null;
  recordedBy: string;
  createdAt: string;
};

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function nullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

export function parseVendorContract(value: unknown): VendorContract | null {
  if (!isRecord(value)) return null;
  const endsOn = nullableString(value.endsOn);
  if (
    typeof value.id !== "string" ||
    typeof value.customerId !== "string" ||
    typeof value.planId !== "string" ||
    typeof value.number !== "string" ||
    typeof value.startsOn !== "string" ||
    endsOn === undefined ||
    !isRecord(value.limits) ||
    !isOneOf(value.status, CONTRACT_STATUSES) ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    return null;
  }
  return { ...value, endsOn, limits: value.limits as Record<string, number> } as VendorContract;
}

export function parseVendorSubscription(value: unknown): VendorSubscription | null {
  if (!isRecord(value)) return null;
  const graceUntil = nullableString(value.graceUntil);
  if (
    typeof value.id !== "string" ||
    typeof value.customerId !== "string" ||
    typeof value.contractId !== "string" ||
    !isOneOf(value.status, SUBSCRIPTION_STATUSES) ||
    typeof value.periodStart !== "string" ||
    typeof value.periodEnd !== "string" ||
    graceUntil === undefined ||
    typeof value.statusChangedAt !== "string" ||
    typeof value.seats !== "number" ||
    typeof value.projectsLimit !== "number" ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    return null;
  }
  return { ...value, graceUntil } as VendorSubscription;
}

export function parseVendorDiscount(value: unknown): VendorDiscount | null {
  if (!isRecord(value)) return null;
  const endsOn = nullableString(value.endsOn);
  const note = nullableString(value.note);
  if (
    typeof value.id !== "string" ||
    typeof value.subscriptionId !== "string" ||
    typeof value.percentBp !== "number" ||
    typeof value.startsOn !== "string" ||
    endsOn === undefined ||
    note === undefined ||
    typeof value.createdBy !== "string" ||
    typeof value.createdAt !== "string"
  ) {
    return null;
  }
  return { ...value, endsOn, note } as VendorDiscount;
}

export function parseVendorInvoice(value: unknown): VendorInvoice | null {
  if (!isRecord(value)) return null;
  const pdfUrl = nullableString(value.pdfUrl);
  if (
    typeof value.id !== "string" ||
    typeof value.customerId !== "string" ||
    typeof value.contractId !== "string" ||
    typeof value.number !== "string" ||
    typeof value.issuedOn !== "string" ||
    typeof value.dueOn !== "string" ||
    typeof value.amountKopecks !== "string" ||
    !isOneOf(value.status, INVOICE_STATUSES) ||
    pdfUrl === undefined ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    return null;
  }
  return { ...value, pdfUrl } as VendorInvoice;
}

export function parseVendorPayment(value: unknown): VendorPayment | null {
  if (!isRecord(value)) return null;
  const reference = nullableString(value.reference);
  if (
    typeof value.id !== "string" ||
    typeof value.invoiceId !== "string" ||
    typeof value.invoiceNumber !== "string" ||
    typeof value.customerId !== "string" ||
    typeof value.customerLegalName !== "string" ||
    typeof value.paidOn !== "string" ||
    typeof value.amountKopecks !== "string" ||
    !isOneOf(value.method, PAYMENT_METHODS) ||
    reference === undefined ||
    typeof value.recordedBy !== "string" ||
    typeof value.createdAt !== "string"
  ) {
    return null;
  }
  return { ...value, reference } as VendorPayment;
}

function parseList<T>(value: unknown, parse: (item: unknown) => T | null): readonly T[] | null {
  if (!isRecord(value) || !Array.isArray(value.items)) return null;
  const items: T[] = [];
  for (const item of value.items) {
    const parsed = parse(item);
    if (parsed === null) return null;
    items.push(parsed);
  }
  return items;
}

export const parseVendorContractList = (value: unknown): readonly VendorContract[] | null =>
  parseList(value, parseVendorContract);

export const parseVendorSubscriptionList = (value: unknown): readonly VendorSubscription[] | null =>
  parseList(value, parseVendorSubscription);

export const parseVendorDiscountList = (value: unknown): readonly VendorDiscount[] | null =>
  parseList(value, parseVendorDiscount);

export const parseVendorInvoiceList = (value: unknown): readonly VendorInvoice[] | null =>
  parseList(value, parseVendorInvoice);

export const parseVendorPaymentList = (value: unknown): readonly VendorPayment[] | null =>
  parseList(value, parseVendorPayment);

export function parseVendorCustomerOne(value: unknown): VendorCustomer | null {
  if (!isRecord(value) || !isRecord(value.customer)) return null;
  return parseVendorCustomer(value.customer);
}

export function parseVendorInvoiceOne(value: unknown): VendorInvoice | null {
  if (!isRecord(value) || !isRecord(value.invoice)) return null;
  return parseVendorInvoice(value.invoice);
}

const PACKAGE_STATUSES = ["issued", "downloaded", "activated", "expired", "revoked"] as const;

export type VendorProvisioningPackageStatus = (typeof PACKAGE_STATUSES)[number];

export type VendorProvisioningPackage = {
  id: string;
  customerId: string;
  customerLegalName: string;
  tokenPrefix: string;
  version: string;
  checksum: string | null;
  status: VendorProvisioningPackageStatus;
  expiresAt: string;
  activatedAt: string | null;
  activatedIp: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type VendorProvisioningPackageIssue = {
  package: VendorProvisioningPackage;
  token: string;
};

export type VendorDashboardGroup = {
  total: number;
  byStatus: Record<string, number>;
};

export type VendorDashboard = {
  customers: VendorDashboardGroup;
  subscriptions: VendorDashboardGroup;
  invoices: VendorDashboardGroup;
  packages: VendorDashboardGroup;
  onboarding: {
    total: number;
    byState: Record<string, number>;
  };
};

export function parseVendorProvisioningPackage(value: unknown): VendorProvisioningPackage | null {
  if (!isRecord(value)) return null;
  const checksum = nullableString(value.checksum);
  const activatedAt = nullableString(value.activatedAt);
  const activatedIp = nullableString(value.activatedIp);
  const createdBy = nullableString(value.createdBy);
  if (
    typeof value.id !== "string" ||
    typeof value.customerId !== "string" ||
    typeof value.customerLegalName !== "string" ||
    typeof value.tokenPrefix !== "string" ||
    typeof value.version !== "string" ||
    checksum === undefined ||
    !isOneOf(value.status, PACKAGE_STATUSES) ||
    typeof value.expiresAt !== "string" ||
    activatedAt === undefined ||
    activatedIp === undefined ||
    createdBy === undefined ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    return null;
  }
  return { ...value, checksum, activatedAt, activatedIp, createdBy } as VendorProvisioningPackage;
}

export function parseVendorProvisioningPackageList(
  value: unknown,
): readonly VendorProvisioningPackage[] | null {
  return parseList(value, parseVendorProvisioningPackage);
}

export function parseVendorProvisioningPackageIssue(
  value: unknown,
): VendorProvisioningPackageIssue | null {
  if (!isRecord(value) || typeof value.token !== "string") return null;
  const pkg = parseVendorProvisioningPackage(value.package);
  return pkg === null ? null : { package: pkg, token: value.token };
}

function parseCountMap(value: unknown): Record<string, number> | null {
  if (!isRecord(value)) return null;
  const result: Record<string, number> = {};
  for (const [key, count] of Object.entries(value)) {
    if (typeof count !== "number") return null;
    result[key] = count;
  }
  return result;
}

function parseDashboardGroup(value: unknown): VendorDashboardGroup | null {
  if (!isRecord(value) || typeof value.total !== "number") return null;
  const byStatus = parseCountMap(value.byStatus);
  return byStatus === null ? null : { total: value.total, byStatus };
}

export function parseVendorDashboard(value: unknown): VendorDashboard | null {
  if (!isRecord(value)) return null;
  const customers = parseDashboardGroup(value.customers);
  const subscriptions = parseDashboardGroup(value.subscriptions);
  const invoices = parseDashboardGroup(value.invoices);
  const packages = parseDashboardGroup(value.packages);
  if (!isRecord(value.onboarding) || typeof value.onboarding.total !== "number") {
    return null;
  }
  const byState = parseCountMap(value.onboarding.byState);
  if (
    customers === null ||
    subscriptions === null ||
    invoices === null ||
    packages === null ||
    byState === null
  ) {
    return null;
  }
  return {
    customers,
    subscriptions,
    invoices,
    packages,
    onboarding: { total: value.onboarding.total, byState },
  };
}
export function readVendorErrorCode(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }
  if (typeof value.code === "string") {
    return value.code;
  }
  const error = value.error;
  if (isRecord(error) && typeof error.code === "string") {
    return error.code;
  }
  return null;
}
