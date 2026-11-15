import { pino, type Logger } from "pino";

import type { Env } from "@partner-coder/config";

const redactPaths = [
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
  "payload.token",
  "payload.secret",
  "data.token",
  "data.secret",
];

export function createLogger(env: Env): Logger {
  return pino({
    level: env.LOG_LEVEL,
    base: {
      service: "partner-coder-worker",
      appEnv: env.APP_ENV,
      nodeEnv: env.NODE_ENV,
    },
    redact: {
      paths: redactPaths,
      censor: "[redacted]",
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}
