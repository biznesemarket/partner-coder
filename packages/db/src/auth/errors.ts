export type MembershipRole = "director" | "developer" | "finance" | "support";

export type MembershipStatus =
  "invited" | "active" | "paused" | "good_leaver" | "bad_leaver" | "disabled";

export type UserStatus = "invited" | "active" | "suspended" | "deleted";

export type AuthServiceErrorCode =
  | "invitation_not_found"
  | "invitation_used"
  | "invitation_expired"
  | "invitation_email_mismatch"
  | "membership_not_found"
  | "membership_inactive"
  | "device_token_not_found"
  | "device_token_revoked"
  | "device_token_expired";

export class AuthServiceError extends Error {
  override readonly name = "AuthServiceError";

  constructor(
    readonly code: AuthServiceErrorCode,
    message: string,
  ) {
    super(message);
  }
}
