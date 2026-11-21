import { z } from "zod";

/**
 * Схема окружения. Единая точка правды для всех приложений монорепозитория:
 * сервис не стартует, если окружение не соответствует схеме.
 */
const booleanFromString = z
  .enum(["true", "false", "1", "0"])
  .transform((value) => value === "true" || value === "1");

const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value === "" ? undefined : value));

/** Origin без path/query/fragment: используется как доверенный источник. */
const originUrl = z
  .string()
  .trim()
  .url("Укажите абсолютный URL origin")
  .refine((value) => {
    const url = new URL(value);
    return url.pathname === "/" && url.search === "" && url.hash === "";
  }, "URL должен содержать только origin без path, query и fragment");

/**
 * WebAuthn RP ID: хост в нижнем регистре без схемы, порта и пути.
 * Каждая метка — 1–63 символа, весь хост — не длиннее 253 символов.
 */
const rpIdSchema = z
  .string()
  .max(253, "VENDOR_WEBAUTHN_RP_ID: максимум 253 символа")
  .regex(
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
    "VENDOR_WEBAUTHN_RP_ID: укажите хост в нижнем регистре без схемы, порта и пути",
  );

export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_ENV: z.enum(["local", "staging", "prod"]).default("local"),

    DATABASE_URL: z.string().min(1, "DATABASE_URL обязателен"),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    /** Логин роли partner_coder_auth; пусто — используется DATABASE_URL. */
    AUTH_DATABASE_URL: optionalString,

    API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    API_BASE_URL: z.string().url(),
    WEB_BASE_URL: z.string().url(),
    VENDOR_BASE_URL: optionalString.pipe(originUrl.optional()),
    /** WebAuthn RP ID вендорской консоли: localhost локально, иначе хост консоли. */
    VENDOR_WEBAUTHN_RP_ID: optionalString.pipe(rpIdSchema.optional()),

    AUTH_SECRET: z.string().min(32, "AUTH_SECRET: минимум 32 символа"),
    /** Доверенные заголовки IP через запятую; пусто — дефолт Better Auth. */
    AUTH_IP_HEADERS: optionalString,
    /** Доверенные прокси/CIDR через запятую для разбора X-Forwarded-For. */
    AUTH_TRUSTED_PROXIES: optionalString,
    SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(12),
    MAGIC_LINK_TTL_MINUTES: z.coerce.number().int().min(5).max(120).default(30),
    /**
     * Хранилище rate limit Better Auth и per-email лимита OTP/magic-link.
     * Явно не задано: local — memory, staging/prod — общий database.
     */
    RATE_LIMIT_STORAGE: optionalString.pipe(z.enum(["memory", "database"]).optional()),

    // Вендорский контур аутентификации: отдельные БД и секрет, локально
    // допустим fallback на DATABASE_URL/AUTH_SECRET.
    VENDOR_DATABASE_URL: optionalString,
    VENDOR_AUTH_DATABASE_URL: optionalString,
    VENDOR_AUTH_SECRET: optionalString.pipe(z.string().min(32).optional()),
    VENDOR_SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24).default(8),
    VENDOR_PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(120).default(30),
    VENDOR_PASSWORD_MIN_LENGTH: z.coerce.number().int().min(12).max(64).default(12),

    S3_ENDPOINT: z.string().url(),
    S3_REGION: z.string().min(1).default("ru-central-1"),
    S3_BUCKET: z.string().min(1),
    S3_ACCESS_KEY: z.string().min(1),
    S3_SECRET_KEY: z.string().min(1),
    S3_FORCE_PATH_STYLE: booleanFromString.prefault("true"),

    SMTP_HOST: z.string().min(1),
    SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(1025),
    SMTP_USER: optionalString,
    SMTP_PASSWORD: optionalString,
    SMTP_FROM: z.string().min(1),

    TELEGRAM_BOT_TOKEN: optionalString,
    TELEGRAM_BOT_USERNAME: optionalString,

    SENTRY_DSN: optionalString,
    OTEL_EXPORTER_OTLP_ENDPOINT: optionalString,
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

    MCP_MIN_VERSION: z.string().default("0.1.0"),
    PACKAGE_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),

    // Worker и pg-boss. Расписания задаются в cron-формате; часовой пояс
    // проектов учитывается внутри задания закрытия дня, а не cron-ом.
    WORKER_METRICS_PORT: z.coerce.number().int().min(1).max(65_535).default(4100),
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(5),
    WORKER_SHUTDOWN_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(300).default(30),
    PG_BOSS_SCHEMA: z
      .string()
      .regex(/^[a-z_][a-z0-9_]*$/)
      .default("pgboss"),
    DAY_CLOSE_CRON: z.string().min(1).default("*/15 * * * *"),
    DAY_CLOSE_CATCHUP_DAYS: z.coerce.number().int().min(1).max(366).default(31),
    AUDIT_ANCHOR_CRON: z.string().min(1).default("15 0 * * *"),
    TTL_CLEANUP_CRON: z.string().min(1).default("30 * * * *"),
    BILLING_STATUS_CRON: z.string().min(1).default("5 * * * *"),
    JOB_RETRY_LIMIT: z.coerce.number().int().min(0).max(20).default(5),
    AUTH_SESSION_RETENTION_DAYS: z.coerce.number().int().min(0).max(365).default(7),
    AUTH_VERIFICATION_RETENTION_DAYS: z.coerce.number().int().min(0).max(90).default(1),
    HEARTBEAT_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(90),

    /** CORS для веб-кабинетов; пусто — WEB_BASE_URL и VENDOR_BASE_URL. */
    API_CORS_ORIGINS: optionalString,
    /** Необязательный токен для /metrics; пусто — метрики открыты в local/staging. */
    METRICS_TOKEN: optionalString,
  })
  .superRefine((value, ctx) => {
    if (value.APP_ENV !== "local" && !value.AUTH_DATABASE_URL) {
      ctx.addIssue({
        code: "custom",
        path: ["AUTH_DATABASE_URL"],
        message:
          "AUTH_DATABASE_URL обязателен вне local: Better Auth должен ходить под partner_coder_auth",
      });
    }
    if (
      value.APP_ENV !== "local" &&
      value.AUTH_SECRET === "local-dev-only-change-me-0123456789abcdef"
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["AUTH_SECRET"],
        message: "AUTH_SECRET не должен совпадать с примером вне local",
      });
    }
    if (value.APP_ENV !== "local" && !value.VENDOR_DATABASE_URL) {
      ctx.addIssue({
        code: "custom",
        path: ["VENDOR_DATABASE_URL"],
        message:
          "VENDOR_DATABASE_URL обязателен вне local: вендорский контур ходит под partner_coder_vendor",
      });
    }
    if (value.APP_ENV !== "local" && !value.VENDOR_AUTH_DATABASE_URL) {
      ctx.addIssue({
        code: "custom",
        path: ["VENDOR_AUTH_DATABASE_URL"],
        message:
          "VENDOR_AUTH_DATABASE_URL обязателен вне local: Better Auth вендоров ходит под partner_coder_vendor_auth",
      });
    }
    if (value.APP_ENV !== "local" && !value.VENDOR_BASE_URL) {
      ctx.addIssue({
        code: "custom",
        path: ["VENDOR_BASE_URL"],
        message:
          "VENDOR_BASE_URL обязателен вне local: origin вендорской консоли (https, без path/query/fragment)",
      });
    }
    if (
      value.APP_ENV !== "local" &&
      value.VENDOR_BASE_URL !== undefined &&
      !value.VENDOR_BASE_URL.startsWith("https://")
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["VENDOR_BASE_URL"],
        message: "VENDOR_BASE_URL вне local должен использовать https",
      });
    }
    if (value.APP_ENV !== "local" && !value.VENDOR_WEBAUTHN_RP_ID) {
      ctx.addIssue({
        code: "custom",
        path: ["VENDOR_WEBAUTHN_RP_ID"],
        message:
          "VENDOR_WEBAUTHN_RP_ID обязателен вне local: хост вендорской консоли без схемы и порта",
      });
    }
    if (value.VENDOR_WEBAUTHN_RP_ID !== undefined && value.VENDOR_BASE_URL !== undefined) {
      const hostname = new URL(value.VENDOR_BASE_URL).hostname;
      const rpId = value.VENDOR_WEBAUTHN_RP_ID;
      if (hostname !== rpId && !hostname.endsWith(`.${rpId}`)) {
        ctx.addIssue({
          code: "custom",
          path: ["VENDOR_WEBAUTHN_RP_ID"],
          message:
            "VENDOR_WEBAUTHN_RP_ID должен совпадать с хостом VENDOR_BASE_URL или быть его суффиксом",
        });
      }
    }
    if (value.APP_ENV !== "local" && !value.VENDOR_AUTH_SECRET) {
      ctx.addIssue({
        code: "custom",
        path: ["VENDOR_AUTH_SECRET"],
        message:
          "VENDOR_AUTH_SECRET обязателен вне local: локальный fallback на AUTH_SECRET запрещён",
      });
    }
    if (
      value.APP_ENV !== "local" &&
      value.VENDOR_AUTH_SECRET !== undefined &&
      value.VENDOR_AUTH_SECRET === value.AUTH_SECRET
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["VENDOR_AUTH_SECRET"],
        message: "VENDOR_AUTH_SECRET не должен совпадать с AUTH_SECRET вне local",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Некорректное окружение:\n${issues.map((issue) => `  - ${issue}`).join("\n")}`);
    this.name = "EnvValidationError";
  }
}

/** Разбирает окружение и падает с понятным сообщением при ошибке. */
export function parseList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }
  return result.data;
}

/**
 * Origin вендорской консоли. Локально допустим дефолт; вне local значение
 * обязательно и уже проверено `parseEnv` (https, только origin).
 */
export function resolveVendorBaseUrl(
  env: Pick<Env, "APP_ENV"> & { readonly VENDOR_BASE_URL?: string | undefined },
): string {
  if (env.VENDOR_BASE_URL) {
    return env.VENDOR_BASE_URL;
  }
  if (env.APP_ENV === "local") {
    return "http://localhost:3001";
  }
  throw new Error("VENDOR_BASE_URL обязателен вне local");
}

/**
 * WebAuthn RP ID вендорской консоли. Локально допустим localhost; вне local
 * значение обязательно и уже проверено `parseEnv`.
 */
export function resolveVendorWebauthnRpId(
  env: Pick<Env, "APP_ENV" | "VENDOR_BASE_URL"> & {
    readonly VENDOR_WEBAUTHN_RP_ID?: string | undefined;
  },
): string {
  if (env.VENDOR_WEBAUTHN_RP_ID) {
    return env.VENDOR_WEBAUTHN_RP_ID;
  }
  if (env.APP_ENV === "local") {
    return "localhost";
  }
  throw new EnvValidationError([
    "VENDOR_WEBAUTHN_RP_ID обязателен вне local: хост вендорской консоли без схемы и порта",
  ]);
}

/**
 * Общий store по умолчанию включается вне local: несколько API-инстансов
 * должны видеть один счетчик OTP/magic-link. Локально достаточно memory.
 */
export function resolveRateLimitStorage(
  env: Pick<Env, "APP_ENV" | "RATE_LIMIT_STORAGE">,
): "memory" | "database" {
  return env.RATE_LIMIT_STORAGE ?? (env.APP_ENV === "local" ? "memory" : "database");
}
