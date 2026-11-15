import { createHash } from "node:crypto";

import {
  calculateDay,
  defaultPolicyDocument,
  loadPolicy,
  policyHash,
  type ExplanationNode,
  type PolicyDocument,
} from "@partner-coder/domain";
import {
  customers,
  contracts,
  dayFlags,
  dayRecords,
  heartbeats,
  intervals,
  invoices,
  memberships,
  payments,
  plans,
  policies,
  projectMembers,
  projects,
  provisioningPackages,
  onboardingSessions,
  rateVersions,
  subscriptions,
  tenantAuditEvents,
  tenants,
  users,
  valuationVersions,
  vendorUsers,
  workSessions,
  type Database,
} from "@partner-coder/db";

const NAMESPACE = "6f1a5f6e-6d1f-4f9f-9f6e-3f5d1c2b4a70";
const DEMO_DAYS = ["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"];

const DEVELOPERS = [
  { key: "dev-1", name: "Анна Смирнова", email: "anna@demo.partnercoder.local" },
  { key: "dev-2", name: "Илья Петров", email: "ilya@demo.partnercoder.local" },
  { key: "dev-3", name: "Мария Козлова", email: "maria@demo.partnercoder.local" },
] as const;

export interface SeedSummary {
  readonly vendorUserId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly developers: number;
  readonly days: number;
  readonly dayRecords: number;
  readonly amountKopecks: bigint;
  readonly equityKopecks: bigint;
}

function stableUuid(name: string): string {
  const namespace = Buffer.from(NAMESPACE.replaceAll("-", ""), "hex");
  const hash = createHash("sha1").update(namespace).update(name, "utf8").digest();
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function id(name: string): string {
  return stableUuid(name);
}

function demoPolicy(tenantId: string, projectId: string, directorId: string): PolicyDocument {
  return defaultPolicyDocument({
    meta: {
      tenant_id: tenantId,
      project_id: projectId,
      approved_by: directorId,
      effective_from: "2026-11-01T00:00:00+03:00",
    },
    project: {
      name: "Демо проект",
      repo: "demo/partner-coder",
      timezone: "Europe/Moscow",
      default_branch: "main",
    },
  });
}

export async function seedDemo(db: Database): Promise<SeedSummary> {
  const vendorUserId = id("vendor-user");
  const planId = id("plan");
  const customerId = id("customer");
  const contractId = id("contract");
  const subscriptionId = id("subscription");
  const invoiceId = id("invoice");
  const paymentId = id("payment");
  const packageId = id("package");
  const onboardingId = id("onboarding");
  const tenantId = id("tenant");
  const directorId = id("user:director");
  const projectId = id("project");
  const policyId = id("policy");
  const auditId = id("audit:seed");

  const membershipIds = new Map<string, string>([
    ["director", id("membership:director")],
    ...DEVELOPERS.map((dev) => [dev.key, id(`membership:${dev.key}`)] as const),
  ]);
  const userIds = new Map<string, string>([
    ["director", directorId],
    ...DEVELOPERS.map((dev) => [dev.key, id(`user:${dev.key}`)] as const),
  ]);

  const policyDocument = demoPolicy(tenantId, projectId, directorId);
  const policy = loadPolicy(policyDocument);

  await db
    .insert(vendorUsers)
    .values({
      id: vendorUserId,
      email: "vendor@demo.partnercoder.local",
      name: "Демо Вендор",
      role: "superadmin",
      status: "active",
      mfaEnabled: true,
    })
    .onConflictDoNothing();

  await db
    .insert(plans)
    .values({
      id: planId,
      code: "demo",
      name: "Демо",
      priceKopecks: 990_000n,
      period: "month",
      seatsLimit: 5,
      projectsLimit: 3,
      features: { digest: true, git: true },
    })
    .onConflictDoNothing();

  await db
    .insert(customers)
    .values({
      id: customerId,
      legalName: "ООО «Демо Клиент»",
      inn: "7700000000",
      kpp: "770001001",
      contact: { name: "Демо Директор", email: "director@demo.partnercoder.local" },
      status: "active",
    })
    .onConflictDoNothing();

  await db
    .insert(contracts)
    .values({
      id: contractId,
      customerId,
      planId,
      number: "DEMO-2026-01",
      startsOn: "2026-11-01",
      status: "active",
    })
    .onConflictDoNothing();

  await db
    .insert(subscriptions)
    .values({
      id: subscriptionId,
      customerId,
      contractId,
      status: "active",
      periodStart: "2026-11-01",
      periodEnd: "2026-12-01",
      seats: 5,
      projectsLimit: 3,
    })
    .onConflictDoNothing();

  await db
    .insert(invoices)
    .values({
      id: invoiceId,
      customerId,
      contractId,
      number: "DEMO-INV-001",
      issuedOn: "2026-11-01",
      dueOn: "2026-11-10",
      amountKopecks: 990_000n,
      status: "paid",
    })
    .onConflictDoNothing();

  await db
    .insert(payments)
    .values({
      id: paymentId,
      invoiceId,
      paidOn: "2026-11-05",
      amountKopecks: 990_000n,
      method: "bank_transfer",
      reference: "DEMO-PAYMENT-001",
      recordedBy: vendorUserId,
    })
    .onConflictDoNothing();

  await db
    .insert(provisioningPackages)
    .values({
      id: packageId,
      customerId,
      tokenHash: createHash("sha256").update("demo-package-token").digest("hex"),
      tokenPrefix: "pc_demo",
      version: "0.1.0",
      status: "activated",
      expiresAt: new Date("2026-12-01T00:00:00Z"),
      activatedAt: new Date("2026-11-02T10:00:00Z"),
      createdBy: vendorUserId,
    })
    .onConflictDoNothing();

  await db
    .insert(onboardingSessions)
    .values({
      id: onboardingId,
      customerId,
      packageId,
      state: "active",
      progressBp: 10_000,
      lastActivityAt: new Date("2026-11-02T10:00:00Z"),
    })
    .onConflictDoNothing();

  await db
    .insert(tenants)
    .values({
      id: tenantId,
      customerId,
      name: "Демо Студия",
      slug: "demo-studio",
      timezone: "Europe/Moscow",
      status: "active",
    })
    .onConflictDoNothing();

  await db
    .insert(users)
    .values([
      {
        id: directorId,
        email: "director@demo.partnercoder.local",
        name: "Демо Директор",
        status: "active",
      },
      ...DEVELOPERS.map((dev) => ({
        id: userIds.get(dev.key)!,
        email: dev.email,
        name: dev.name,
        status: "active" as const,
      })),
    ])
    .onConflictDoNothing();

  await db
    .insert(memberships)
    .values([
      {
        id: membershipIds.get("director")!,
        tenantId,
        userId: directorId,
        role: "director",
        status: "active",
        displayName: "Демо Директор",
        joinedAt: new Date("2026-11-01T00:00:00Z"),
      },
      ...DEVELOPERS.map((dev) => ({
        id: membershipIds.get(dev.key)!,
        tenantId,
        userId: userIds.get(dev.key)!,
        role: "developer" as const,
        status: "active" as const,
        displayName: dev.name,
        joinedAt: new Date("2026-11-01T00:00:00Z"),
      })),
    ])
    .onConflictDoNothing();

  await db
    .insert(projects)
    .values({
      id: projectId,
      tenantId,
      name: "Демо проект",
      forge: "github",
      repo: "demo/partner-coder",
      defaultBranch: "main",
      timezone: "Europe/Moscow",
      status: "active",
    })
    .onConflictDoNothing();

  await db
    .insert(projectMembers)
    .values(
      [...membershipIds.entries()].map(([key, membershipId]) => ({
        tenantId,
        projectId,
        membershipId,
        role: key === "director" ? ("director" as const) : ("developer" as const),
      })),
    )
    .onConflictDoNothing();

  await db
    .insert(policies)
    .values({
      id: policyId,
      tenantId,
      projectId,
      version: 1,
      params: policyDocument,
      effectiveFrom: new Date("2026-11-01T00:00:00+03:00"),
      approvedBy: directorId,
      sha256: policyHash(policyDocument),
    })
    .onConflictDoNothing();

  await db
    .insert(rateVersions)
    .values({
      id: id("rate-version:1"),
      tenantId,
      policyId,
      effectiveFrom: new Date("2026-11-01T00:00:00+03:00"),
      valueKopecks: 50_000n,
      reason: "Стартовая ставка часа работы с ИИ-агентом",
      approvedBy: directorId,
    })
    .onConflictDoNothing();

  await db
    .insert(valuationVersions)
    .values({
      id: id("valuation-version:1"),
      tenantId,
      policyId,
      effectiveFrom: new Date("2026-11-01T00:00:00+03:00"),
      valueKopecks: 1_000_000_000n,
      reason: "Стартовая оценка проекта",
      approvedBy: directorId,
      adrRef: "ADR-0003",
    })
    .onConflictDoNothing();

  await db
    .insert(tenantAuditEvents)
    .values({
      id: auditId,
      tenantId,
      actor: directorId,
      actorType: "system",
      action: "seed.demo_created",
      entity: "tenant",
      after: { slug: "demo-studio", days: DEMO_DAYS.length, developers: DEVELOPERS.length },
      hash: "0".repeat(64),
    })
    .onConflictDoNothing();

  let amountKopecks = 0n;
  let equityKopecks = 0n;
  let records = 0;

  for (const date of DEMO_DAYS) {
    for (const developer of DEVELOPERS) {
      const membershipId = membershipIds.get(developer.key)!;
      const sessionId = id(`session:${developer.key}:${date}`);
      const start = `${date}T09:00:00+03:00`;
      const activeEnd = `${date}T13:00:00+03:00`;
      const supervisedEnd = `${date}T14:00:00+03:00`;
      const end = `${date}T15:00:00+03:00`;
      const intervalsInput = [
        { class: "active_human" as const, start, end: activeEnd },
        { class: "supervised_agent" as const, start: activeEnd, end: supervisedEnd },
        { class: "autonomous_agent" as const, start: supervisedEnd, end },
      ];
      const session = {
        id: sessionId,
        membershipId,
        taskRef: `TASK-${date}-${developer.key}`,
        branch: "main",
        intervals: intervalsInput,
      };

      const calculation = calculateDay({
        policy,
        date,
        sessions: [session],
        pool: { accruedEquityKopecks: equityKopecks },
      });

      await db
        .insert(workSessions)
        .values({
          id: sessionId,
          tenantId,
          projectId,
          membershipId,
          taskRef: session.taskRef,
          branch: session.branch,
          status: "ended",
          startedAt: new Date(start),
          endedAt: new Date(end),
        })
        .onConflictDoNothing();

      await db
        .insert(heartbeats)
        .values(
          intervalsInput.map((interval, index) => ({
            eventId: id(`heartbeat:${developer.key}:${date}:${index}`),
            tenantId,
            sessionId,
            seq: index,
            class: interval.class,
            startUtc: new Date(interval.start),
            endUtc: new Date(interval.end),
            signals: { input_events: 10 + index, tool_calls: 2 },
            signatureValid: true,
          })),
        )
        .onConflictDoNothing();

      await db
        .insert(intervals)
        .values(
          intervalsInput.map((interval, index) => ({
            id: id(`interval:${developer.key}:${date}:${index}`),
            tenantId,
            sessionId,
            class: interval.class,
            startUtc: new Date(interval.start),
            endUtc: new Date(interval.end),
            seconds: Math.round((Date.parse(interval.end) - Date.parse(interval.start)) / 1000),
            source: "agent" as const,
          })),
        )
        .onConflictDoNothing();

      await db
        .insert(dayRecords)
        .values({
          id: id(`day:${developer.key}:${date}`),
          tenantId,
          projectId,
          membershipId,
          dateLocal: date,
          timezone: policy.project.timezone,
          paidSeconds: calculation.paidSeconds,
          trackedSeconds: calculation.trackedSeconds,
          classes: calculation.classes,
          amountKopecks: calculation.amountKopecks,
          cashKopecks: calculation.cashKopecks,
          equityKopecks: calculation.equityKopecks,
          shareBp: calculation.shareBp,
          poolUsedBp: Number(calculation.poolUsedBp),
          poolPending: calculation.poolPending,
          pendingEquityKopecks: calculation.pendingEquityKopecks,
          versions: calculation.versions,
          inputHash: calculation.inputHash,
          explanation: calculation.explanation as unknown as ExplanationNode,
          closedAt: new Date(`${date}T23:59:59+03:00`),
        })
        .onConflictDoNothing();

      if (calculation.flags.length > 0) {
        await db
          .insert(dayFlags)
          .values(
            calculation.flags.map((flag) => ({
              id: id(`flag:${developer.key}:${date}:${flag.code}`),
              tenantId,
              dayRecordId: id(`day:${developer.key}:${date}`),
              code: flag.code,
              detail: flag.detail,
            })),
          )
          .onConflictDoNothing();
      }

      amountKopecks += calculation.amountKopecks;
      equityKopecks += calculation.equityKopecks;
      records += 1;
    }
  }

  return {
    vendorUserId,
    tenantId,
    projectId,
    developers: DEVELOPERS.length,
    days: DEMO_DAYS.length,
    dayRecords: records,
    amountKopecks,
    equityKopecks,
  };
}
