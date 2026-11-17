/**
 * Учётные записи, которые создаёт `e2e/prepare.mjs`. Значения email должны
 * совпадать с константами в `prepare.mjs`: он исполняется как plain ESM и не
 * может импортировать TypeScript. Пароли локальные тестовые и не являются
 * секретами; TOTP-секрет в код не попадает и читается из `.auth/`.
 */
export const ENROLLED_ADMIN = {
  email: "e2e-superadmin@example.test",
  password: "correct horse battery staple e2e",
} as const;

/** Второй админ остаётся без TOTP, чтобы reachable был `/setup-mfa`. */
export const SETUP_MFA_ADMIN = {
  email: "e2e-a11y@example.test",
  password: "correct horse battery staple setup",
} as const;
