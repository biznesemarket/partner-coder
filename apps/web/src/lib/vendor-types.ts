const VENDOR_ROLES = ["superadmin", "finance", "support", "readonly"] as const;

const VENDOR_STATUSES = ["invited", "active", "suspended", "disabled"] as const;

export type VendorRole = (typeof VENDOR_ROLES)[number];

export type VendorUserStatus = (typeof VENDOR_STATUSES)[number];

export type VendorMeUser = {
  id: string;
  email: string;
  name: string;
  role: VendorRole;
  status: VendorUserStatus;
  twoFactorEnabled: boolean;
};

export type VendorMe = {
  user: VendorMeUser;
  mfaEnrollmentRequired: boolean;
  sessionExpiresAt: string;
  stepUpUntil: string | null;
};

export type VendorMeResult =
  | { kind: "ok"; me: VendorMe }
  | { kind: "unauthenticated" }
  | { kind: "inactive" }
  | { kind: "error" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isVendorRole(value: unknown): value is VendorRole {
  return typeof value === "string" && (VENDOR_ROLES as readonly string[]).includes(value);
}

export function isVendorUserStatus(value: unknown): value is VendorUserStatus {
  return typeof value === "string" && (VENDOR_STATUSES as readonly string[]).includes(value);
}

export function parseVendorMe(value: unknown): VendorMe | null {
  if (!isRecord(value)) {
    return null;
  }

  const user = value.user;
  if (!isRecord(user)) {
    return null;
  }

  if (
    typeof user.id !== "string" ||
    typeof user.email !== "string" ||
    typeof user.name !== "string" ||
    !isVendorRole(user.role) ||
    !isVendorUserStatus(user.status) ||
    typeof user.twoFactorEnabled !== "boolean"
  ) {
    return null;
  }

  if (
    typeof value.mfaEnrollmentRequired !== "boolean" ||
    typeof value.sessionExpiresAt !== "string"
  ) {
    return null;
  }

  const stepUpUntil = value.stepUpUntil;
  if (stepUpUntil !== null && typeof stepUpUntil !== "string") {
    return null;
  }

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
      twoFactorEnabled: user.twoFactorEnabled,
    },
    mfaEnrollmentRequired: value.mfaEnrollmentRequired,
    sessionExpiresAt: value.sessionExpiresAt,
    stepUpUntil,
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

export function vendorMeResultFromResponse(status: number, body: unknown): VendorMeResult {
  if (status === 200) {
    const me = parseVendorMe(body);
    return me === null ? { kind: "error" } : { kind: "ok", me };
  }

  if (status === 401) {
    return { kind: "unauthenticated" };
  }

  if (status === 403 && readVendorErrorCode(body) === "vendor_inactive") {
    return { kind: "inactive" };
  }

  return { kind: "error" };
}
