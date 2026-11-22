import { BlockList, isIP } from "node:net";

function normalizeAddress(value: string): string {
  const lower = value.toLowerCase();
  if (lower.startsWith("::ffff:")) {
    const mapped = lower.slice("::ffff:".length);
    if (isIP(mapped) === 4) {
      return mapped;
    }
  }
  return value;
}

function addressType(value: string): "ipv4" | "ipv6" | null {
  const type = isIP(value);
  return type === 4 ? "ipv4" : type === 6 ? "ipv6" : null;
}

/**
 * Создаёт проверку IP по списку адресов/CIDR. Пустой список разрешает все
 * адреса: ограничение включается только явной настройкой.
 */
export function createMetricsIpAllowlist(
  entries: readonly string[],
): (ip: string | null | undefined) => boolean {
  if (entries.length === 0) {
    return () => true;
  }

  const blockList = new BlockList();
  for (const entry of entries) {
    const [rawAddress, rawPrefix] = entry.split("/");
    const address = normalizeAddress(rawAddress?.trim() ?? "");
    const type = addressType(address);
    if (type === null) {
      throw new RangeError(`Некорректный IP/CIDR в METRICS_IP_ALLOWLIST: ${entry}`);
    }
    const maxPrefix = type === "ipv4" ? 32 : 128;
    const prefix = rawPrefix === undefined ? maxPrefix : Number(rawPrefix);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) {
      throw new RangeError(`Некорректный префикс в METRICS_IP_ALLOWLIST: ${entry}`);
    }
    blockList.addSubnet(address, prefix, type);
  }

  return (ip) => {
    if (typeof ip !== "string") {
      return false;
    }
    const address = normalizeAddress(ip);
    const type = addressType(address);
    return type !== null && blockList.check(address, type);
  };
}
