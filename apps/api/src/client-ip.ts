import { TRUSTED_CLIENT_IP_HEADER, verifyClientIpSignature } from "@partner-coder/domain";
import type { FastifyRequest } from "fastify";

export function verifyTrustedClientIp(
  rawIp: unknown,
  rawSignature: unknown,
  secret: string,
): string | null {
  if (typeof rawIp !== "string" || typeof rawSignature !== "string") {
    return null;
  }
  return verifyClientIpSignature(secret, rawIp, rawSignature) ? rawIp : null;
}

export function requestClientIp(request: FastifyRequest): string | null {
  const verified = request.headers[TRUSTED_CLIENT_IP_HEADER];
  return typeof verified === "string" && verified !== "" ? verified : request.ip || null;
}
