import type { VendorMeResult } from "./vendor-types";

export type GuardAction = "render" | "login" | "inactive" | "mfa" | "error";

export function guardAction(result: VendorMeResult): GuardAction {
  switch (result.kind) {
    case "error":
      return "error";
    case "unauthenticated":
      return "login";
    case "inactive":
      return "inactive";
    case "ok":
      return result.me.mfaEnrollmentRequired ? "mfa" : "render";
  }
}
