export function normalizeOtp(value: string): string {
  return value.replace(/\D/g, "").slice(0, 6);
}

export function normalizeBackupCode(value: string): string {
  return value.trim();
}
