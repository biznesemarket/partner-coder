import { PgBoss, type Job } from "pg-boss";
import type { Logger } from "pino";
import { z } from "zod";

import type { Env } from "@partner-coder/config";
import type { Database } from "@partner-coder/db";

import type { JobMetrics } from "./metrics.js";
import { anchorAudits } from "./jobs/audit-anchor.js";
import { advanceBillingStatuses } from "./jobs/billing-status.js";
import { closeProjectDay } from "./jobs/day-close.js";
import { scanDueDays } from "./jobs/day-close-scan.js";
import { runTtlCleanup } from "./jobs/ttl-cleanup.js";

export const queueNames = {
  dayCloseScan: "day-close-scan",
  dayClose: "day-close",
  auditAnchor: "audit-anchor",
  ttlCleanup: "ttl-cleanup",
  billingStatusScan: "billing-status-scan",
} as const;

export const deadLetterNames = {
  dayCloseScan: "day-close-scan-dlq",
  dayClose: "day-close-dlq",
  auditAnchor: "audit-anchor-dlq",
  ttlCleanup: "ttl-cleanup-dlq",
  billingStatusScan: "billing-status-scan-dlq",
} as const;

const dayCloseJobSchema = z.object({
  tenantId: z.uuid(),
  projectId: z.uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export interface WorkerRuntime {
  readonly boss: PgBoss;
  stop(): Promise<void>;
}

export interface WorkerOptions {
  readonly env: Env;
  readonly db: Database;
  readonly logger: Logger;
  readonly metrics: JobMetrics;
}

export async function startWorker(options: WorkerOptions): Promise<WorkerRuntime> {
  const { env, db, logger, metrics } = options;
  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    schema: env.PG_BOSS_SCHEMA,
    application_name: "partner-coder-worker",
  });

  boss.on("error", (error) => logger.error({ err: error }, "pg_boss_error"));
  boss.on("warning", (warning) => logger.warn({ warning }, "pg_boss_warning"));

  await boss.start();

  for (const dlq of Object.values(deadLetterNames)) {
    await boss.createQueue(dlq, { retryLimit: 0 });
  }
  for (const name of Object.values(queueNames)) {
    await boss.createQueue(name, {
      retryLimit: env.JOB_RETRY_LIMIT,
      retryDelay: 60,
      retryBackoff: true,
      deadLetter: `${name}-dlq`,
    });
  }

  const work = <T>(queue: string, handler: (data: T, job: Job<T>) => Promise<unknown>) =>
    boss.work<T>(queue, { localConcurrency: env.WORKER_CONCURRENCY }, async (jobs) => {
      for (const job of jobs) {
        await metrics.observe(queue, async () => {
          try {
            const output = await handler(job.data, job);
            logger.info({ job: queue, jobId: job.id, output }, "job_completed");
            return output;
          } catch (error) {
            logger.error(
              { err: error, job: queue, jobId: job.id, retryCount: job.retryCount },
              "job_failed",
            );
            throw error;
          }
        });
      }
    });

  await work<null>(queueNames.dayCloseScan, async () => {
    const items = await scanDueDays(db, { catchupDays: env.DAY_CLOSE_CATCHUP_DAYS });
    let enqueued = 0;
    let skipped = 0;
    for (const item of items) {
      for (const date of item.dates) {
        const id = await boss.send(
          queueNames.dayClose,
          { tenantId: item.tenantId, projectId: item.projectId, date },
          {
            singletonKey: `day-close:${item.tenantId}:${item.projectId}:${date}`,
            singletonSeconds: 6 * 60 * 60,
          },
        );
        if (id) enqueued += 1;
        else skipped += 1;
      }
    }
    return { projects: items.length, enqueued, skipped };
  });

  await work<unknown>(queueNames.dayClose, async (data) => {
    const input = dayCloseJobSchema.parse(data);
    return closeProjectDay(db, input);
  });

  await work<null>(queueNames.auditAnchor, async () => {
    return anchorAudits(db);
  });

  await work<null>(queueNames.billingStatusScan, async () => {
    return advanceBillingStatuses(db);
  });

  await work<null>(queueNames.ttlCleanup, async () => {
    return runTtlCleanup(db, {
      sessionRetentionDays: env.AUTH_SESSION_RETENTION_DAYS,
      verificationRetentionDays: env.AUTH_VERIFICATION_RETENTION_DAYS,
      heartbeatRetentionDays: env.HEARTBEAT_RETENTION_DAYS,
    });
  });

  const schedule = { tz: "UTC" as const };
  await boss.schedule(queueNames.dayCloseScan, env.DAY_CLOSE_CRON, null, schedule);
  await boss.schedule(queueNames.auditAnchor, env.AUDIT_ANCHOR_CRON, null, schedule);
  await boss.schedule(queueNames.ttlCleanup, env.TTL_CLEANUP_CRON, null, schedule);
  await boss.schedule(queueNames.billingStatusScan, env.BILLING_STATUS_CRON, null, schedule);

  logger.info(
    {
      schema: env.PG_BOSS_SCHEMA,
      dayCloseCron: env.DAY_CLOSE_CRON,
      auditAnchorCron: env.AUDIT_ANCHOR_CRON,
      ttlCleanupCron: env.TTL_CLEANUP_CRON,
      billingStatusCron: env.BILLING_STATUS_CRON,
    },
    "worker_started",
  );

  return {
    boss,
    async stop() {
      await boss.stop({
        graceful: true,
        timeout: env.WORKER_SHUTDOWN_TIMEOUT_SECONDS * 1000,
      });
      logger.info("worker_stopped");
    },
  };
}
