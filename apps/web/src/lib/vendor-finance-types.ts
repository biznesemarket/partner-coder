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
