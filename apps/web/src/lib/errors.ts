import { errors } from "./messages";

export type AuthErrorLike = {
  code?: string | null | undefined;
  status?: number | null | undefined;
  statusCode?: number | null | undefined;
};

const CODE_MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: errors.invalidCredentials,
  INVALID_CREDENTIALS: errors.invalidCredentials,
  VENDOR_INACTIVE: errors.inactive,
  vendor_inactive: errors.inactive,
  ACCOUNT_TEMPORARILY_LOCKED: errors.tooManyAttempts,
  INVALID_CODE: errors.invalidCode,
  INVALID_TWO_FACTOR_CODE: errors.invalidCode,
  INVALID_TWO_FACTOR_COOKIE: errors.sessionExpiredRestart,
  SESSION_EXPIRED: errors.sessionExpiredRestart,
  TOTP_ALREADY_ENABLED: errors.totpAlreadyEnabled,
  SESSION_NOT_FRESH: errors.sessionNotFresh,
  PREVIOUSLY_REGISTERED: errors.passkeyAlreadyRegistered,
  AUTH_CANCELLED: errors.cancelled,
  REGISTRATION_CANCELLED: errors.cancelled,
  vendor_mfa_required: errors.mfaRequired,
  vendor_step_up_required: errors.stepUpRequired,
  upstream_unavailable: errors.serviceUnavailable,
};

function readStatus(error: AuthErrorLike | null | undefined): number | null {
  if (typeof error?.status === "number") {
    return error.status;
  }

  if (typeof error?.statusCode === "number") {
    return error.statusCode;
  }

  return null;
}

export function mapAuthError(error: AuthErrorLike | null | undefined): string {
  if (typeof error?.code === "string") {
    const message = CODE_MESSAGES[error.code];
    if (message !== undefined) {
      return message;
    }
  }

  const status = readStatus(error);
  if (status === 429) {
    return errors.tooManyAttempts;
  }

  if (status === 401) {
    return errors.sessionExpired;
  }

  if (status !== null && status >= 500) {
    return errors.serviceUnavailable;
  }

  return errors.generic;
}
