const CANCELLATION_CODES = new Set([
  "AUTH_CANCELLED",
  "REGISTRATION_CANCELLED",
  "ERROR_CEREMONY_ABORTED",
  "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
]);

const CANCELLATION_NAMES = new Set(["NotAllowedError", "AbortError"]);

function readProperty(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  return key in value ? (value as Record<string, unknown>)[key] : undefined;
}

function readName(value: unknown): string | null {
  const name = readProperty(value, "name");
  return typeof name === "string" ? name : null;
}

/**
 * Отмена passkey — обычное действие пользователя, а не сбой. Better Auth
 * отдаёт код WebAuthnError (`ERROR_CEREMONY_ABORTED` при abort,
 * `ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY` при NotAllowedError) либо
 * `AUTH_CANCELLED`. Дополнительно распознаём браузерные имена отмены, если
 * они попали в ошибку или её `cause`, чтобы не показывать ложную ошибку.
 */
export function isPasskeyCancellation(error: unknown): boolean {
  const code = readProperty(error, "code");

  if (typeof code === "string" && CANCELLATION_CODES.has(code)) {
    return true;
  }

  const name = readName(error);
  if (name !== null && CANCELLATION_NAMES.has(name)) {
    return true;
  }

  const causeName = readName(readProperty(error, "cause"));

  return causeName !== null && CANCELLATION_NAMES.has(causeName);
}
