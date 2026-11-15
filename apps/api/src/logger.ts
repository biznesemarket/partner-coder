import { pino, type LoggerOptions } from "pino";

import type { Env } from "@partner-coder/config";

const SENSITIVE_QUERY_KEYS = new Set([
  "token",
  "key",
  "secret",
  "code",
  "otp",
  "magic",
  "invitation",
  "password",
  "authorization",
  "access_token",
  "refresh_token",
]);

const SENSITIVE_PATH_SEGMENTS = /(\/invitations\/)([^/?#]+)/g;

export function redactUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl, "http://localhost");
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
        url.searchParams.set(key, "[redacted]");
      }
    }
    url.pathname = url.pathname.replace(
      SENSITIVE_PATH_SEGMENTS,
      (_match, prefix: string) => `${prefix}[redacted]`,
    );
    return `${url.pathname}${url.search}`;
  } catch {
    return "[unparseable-url]";
  }
}

export function loggerOptions(env: Env): LoggerOptions {
  return {
    level: env.LOG_LEVEL,
    base: {
      service: "partner-coder-api",
      appEnv: env.APP_ENV,
      nodeEnv: env.NODE_ENV,
    },
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "res.headers['set-cookie']",
        "authorization",
        "token",
        "secret",
        "password",
        "*.authorization",
        "*.token",
        "*.secret",
        "*.password",
      ],
      censor: "[redacted]",
    },
    serializers: {
      req(request: unknown) {
        const value = request as {
          id?: string;
          method?: string;
          url?: string;
          ip?: string;
        };
        return {
          id: value.id,
          method: value.method,
          url: redactUrl(value.url ?? ""),
          remoteAddress: value.ip,
        };
      },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };
}
