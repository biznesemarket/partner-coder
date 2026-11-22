import { createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

export const TRUSTED_CLIENT_IP_HEADER = "x-pc-client-ip";
export const TRUSTED_CLIENT_IP_SIGNATURE_HEADER = "x-pc-client-ip-signature";

const SIGNATURE_PATTERN = /^[0-9a-f]{64}$/;

function candidateFrom(value: string): string {
  const first = value.split(",")[0]?.trim() ?? "";
  if (first.startsWith("[") && first.includes("]")) {
    return first.slice(1, first.indexOf("]"));
  }

  const ipv4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(first);
  return ipv4WithPort?.[1] ?? first;
}

/** Первый IP из заголовка reverse proxy; null для мусора и пустых значений. */
export function normalizeClientIp(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const candidate = candidateFrom(value);
  return candidate !== "" && isIP(candidate) !== 0 ? candidate : null;
}

function canonicalPayload(ip: string): string {
  return `v1|${ip}`;
}

export function signClientIp(secret: string, ip: string): string {
  const normalized = normalizeClientIp(ip);
  if (normalized === null) {
    throw new RangeError("Ожидался IP-адрес");
  }
  return createHmac("sha256", secret).update(canonicalPayload(normalized)).digest("hex");
}

export function verifyClientIpSignature(secret: string, ip: string, signature: string): boolean {
  const normalized = normalizeClientIp(ip);
  if (normalized === null || !SIGNATURE_PATTERN.test(signature)) {
    return false;
  }

  const expected = Buffer.from(signClientIp(secret, normalized), "hex");
  const actual = Buffer.from(signature, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
