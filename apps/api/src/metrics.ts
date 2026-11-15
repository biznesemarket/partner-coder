import { Counter, Histogram, Registry } from "prom-client";
import type { FastifyRequest } from "fastify";

export interface HttpMetrics {
  readonly registry: Registry;
  readonly requestCounter: Counter<"method" | "route" | "status">;
  readonly requestDuration: Histogram<"method" | "route" | "status">;
  routeOf(request: FastifyRequest): string;
}

export function createHttpMetrics(): HttpMetrics {
  const registry = new Registry();
  const requestCounter = new Counter({
    name: "partner_coder_http_requests_total",
    help: "Количество HTTP-запросов API",
    labelNames: ["method", "route", "status"],
    registers: [registry],
  });
  const requestDuration = new Histogram({
    name: "partner_coder_http_request_duration_seconds",
    help: "Длительность HTTP-запроса API",
    labelNames: ["method", "route", "status"],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
  });

  return {
    registry,
    requestCounter,
    requestDuration,
    routeOf(request) {
      return request.routeOptions?.url ?? "not_found";
    },
  };
}
