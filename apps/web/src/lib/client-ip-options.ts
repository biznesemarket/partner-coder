import type { ProxyVendorRequestOptions } from "./proxy";

export function trustedClientIpOptions(): Pick<
  ProxyVendorRequestOptions,
  "trustedClientIpSecret" | "clientIpSourceHeader"
> {
  const secret = process.env.TRUSTED_CLIENT_IP_SECRET;
  if (!secret) {
    return {};
  }

  return {
    trustedClientIpSecret: secret,
    clientIpSourceHeader: process.env.TRUSTED_CLIENT_IP_SOURCE_HEADER ?? "x-forwarded-for",
  };
}
