import { createServer, type Server } from "node:http";

import type { Logger } from "pino";
import { Counter, Gauge, Histogram, Registry } from "prom-client";

export type JobStatus = "completed" | "failed";

export class JobMetrics {
  readonly registry = new Registry();
  private readonly runs: Counter<"job" | "status">;
  private readonly duration: Histogram<"job">;
  private readonly lastSuccess: Gauge<"job">;

  constructor() {
    this.runs = new Counter({
      name: "partner_coder_job_runs_total",
      help: "Количество запусков фоновых заданий",
      labelNames: ["job", "status"],
      registers: [this.registry],
    });
    this.duration = new Histogram({
      name: "partner_coder_job_duration_seconds",
      help: "Длительность фонового задания",
      labelNames: ["job"],
      buckets: [0.05, 0.25, 1, 5, 15, 60, 300],
      registers: [this.registry],
    });
    this.lastSuccess = new Gauge({
      name: "partner_coder_job_last_success_timestamp_seconds",
      help: "Unix-время последнего успешного запуска задания",
      labelNames: ["job"],
      registers: [this.registry],
    });
  }

  async observe<T>(job: string, fn: () => Promise<T>): Promise<T> {
    const started = process.hrtime.bigint();
    try {
      const result = await fn();
      this.duration.observe({ job }, Number(process.hrtime.bigint() - started) / 1e9);
      this.runs.inc({ job, status: "completed" });
      this.lastSuccess.set({ job }, Date.now() / 1000);
      return result;
    } catch (error) {
      this.duration.observe({ job }, Number(process.hrtime.bigint() - started) / 1e9);
      this.runs.inc({ job, status: "failed" });
      throw error;
    }
  }
}

export function startMetricsServer(
  registry: Registry,
  port: number,
  logger: Logger,
): Promise<Server> {
  const server = createServer(async (request, response) => {
    if (request.url !== "/metrics") {
      response.statusCode = 404;
      response.end("not found");
      return;
    }
    try {
      const body = await registry.metrics();
      response.statusCode = 200;
      response.setHeader("content-type", registry.contentType);
      response.end(body);
    } catch (error) {
      logger.error({ err: error }, "worker_metrics_failed");
      response.statusCode = 500;
      response.end("metrics error");
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => {
      logger.info({ port }, "worker_metrics_listening");
      resolve(server);
    });
  });
}
