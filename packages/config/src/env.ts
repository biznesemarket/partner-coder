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
    VENDOR_BASE_URL: z.string().url().default("http://localhost:3001"),

    AUTH_SECRET: z.string().min(32, "AUTH_SECRET: минимум 32 символа"),
    /** Доверенные заголовки IP через запятую; пусто — дефолт Better Auth. */
    AUTH_IP_HEADERS: optionalString,
    /** Доверенные прокси/CIDR через запятую для разбора X-Forwarded-For. */
    AUTH_TRUSTED_PROXIES: optionalString,
    SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(12),
    MAGIC_LINK_TTL_MINUTES: z.coerce.number().int().min(5).max(120).default(30),

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
