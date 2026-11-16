/**
 * Новые события вендорского аудита (спека §9). Существующие литералы не
 * переводятся сюда: константы используются только новым кодом.
 */
export const VENDOR_AUDIT_ACTIONS = {
  signInSucceeded: "vendor.auth.sign_in_succeeded",
  signInFailed: "vendor.auth.sign_in_failed",
  mfaFailed: "vendor.auth.mfa_failed",
  signedOut: "vendor.auth.signed_out",
  passwordChanged: "vendor.auth.password_changed",
  sessionRevoked: "vendor.auth.session_revoked",
  mfaEnabled: "vendor.user.mfa_enabled",
} as const;
