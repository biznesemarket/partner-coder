import type { FastifyInstance } from "fastify";

import {
  getCustomerById,
  getProvisioningPackageById,
  issueProvisioningPackage,
  listProvisioningPackages,
  revokeProvisioningPackage,
  upsertOnboardingSession,
  writeVendorAudit,
  type Database,
  type ProvisioningPackage,
} from "@partner-coder/db";

import { ApiError } from "../errors.js";
import {
  vendorIdParamsSchema,
  vendorProvisioningPackageListQuerySchema,
  vendorProvisioningPackageReissueSchema,
} from "../openapi/schemas.js";
import { createVendorGuards } from "../vendor-auth/guard.js";
import type { VendorAuthRuntime } from "../vendor-auth/runtime.js";
import { parseBody, parseParams, parseQuery } from "./validation.js";

const readRoles = ["superadmin", "finance", "support", "readonly"] as const;
const adminRoles = ["superadmin"] as const;
const reissueRoles = ["superadmin", "support"] as const;

function packageResponse(pkg: ProvisioningPackage, customerLegalName: string) {
  return {
    id: pkg.id,
    customerId: pkg.customerId,
    customerLegalName,
    tokenPrefix: pkg.tokenPrefix,
    version: pkg.version,
    checksum: pkg.checksum,
    status: pkg.status,
    expiresAt: pkg.expiresAt.toISOString(),
    activatedAt: pkg.activatedAt?.toISOString() ?? null,
    activatedIp: pkg.activatedIp,
    createdBy: pkg.createdBy,
    createdAt: pkg.createdAt.toISOString(),
    updatedAt: pkg.updatedAt.toISOString(),
  };
}

export function registerVendorPackageRoutes(
  server: FastifyInstance,
  runtime: VendorAuthRuntime,
): void {
  const guards = createVendorGuards(runtime);
  const readGuards = [
    guards.authenticateVendor,
    guards.requireVendorMfa,
    guards.requireVendorRole(readRoles),
  ];
  const issueGuards = [
    guards.authenticateVendor,
    guards.requireVendorMfa,
    guards.requireVendorRole(adminRoles),
  ];
  const reissueGuards = [
    guards.authenticateVendor,
    guards.requireVendorMfa,
    guards.requireVendorRole(reissueRoles),
  ];
  const ttlDays = runtime.packageTtlDays ?? 7;
  const version = runtime.packageVersion ?? "0.1.0";

  server.get("/v1/vendor/packages", { preHandler: readGuards }, async (request) => {
    const query = parseQuery(vendorProvisioningPackageListQuerySchema, request.query);
    const items = await listProvisioningPackages(runtime.db, {
      ...(query.customerId === undefined ? {} : { customerId: query.customerId }),
      ...(query.status === undefined ? {} : { status: query.status }),
      limit: query.limit,
    });
    return {
      items: items.map((item) => packageResponse(item, item.customerLegalName)),
    };
  });

  server.post(
    "/v1/vendor/customers/:id/packages",
    { preHandler: issueGuards },
    async (request, reply) => {
      const identity = request.vendorAuth!;
      const { id } = parseParams(vendorIdParamsSchema, request.params);
      const customer = await getCustomerById(runtime.db, id);
      if (!customer) {
        throw new ApiError(404, "vendor_customer_not_found", "Клиент не найден");
      }

      const now = new Date();
      const result = await runtime.db.transaction(async (tx) => {
        const txDb = tx as unknown as Database;
        const issued = await issueProvisioningPackage(txDb, {
          customerId: id,
          version,
          ttlDays,
          createdBy: identity.userId,
          now,
        });
        const onboarding = await upsertOnboardingSession(txDb, {
          customerId: id,
          packageId: issued.package.id,
          now,
        });
        await writeVendorAudit(tx, {
          actorId: identity.userId,
          customerId: id,
          action: "vendor.package.issued",
          entity: "provisioning_package",
          after: {
            packageId: issued.package.id,
            customerId: id,
            tokenPrefix: issued.package.tokenPrefix,
            version: issued.package.version,
            status: issued.package.status,
            expiresAt: issued.package.expiresAt.toISOString(),
            onboardingSessionId: onboarding.id,
          },
          ip: request.ip || null,
        });
        return issued;
      });

      return reply.status(201).send({
        package: packageResponse(result.package, customer.legalName),
        token: result.token,
      });
    },
  );

  server.post(
    "/v1/vendor/packages/:id/reissue",
    { preHandler: reissueGuards },
    async (request, reply) => {
      const identity = request.vendorAuth!;
      const { id } = parseParams(vendorIdParamsSchema, request.params);
      const input = parseBody(vendorProvisioningPackageReissueSchema, request.body ?? {});
      const current = await getProvisioningPackageById(runtime.db, id);
      if (!current) {
        throw new ApiError(404, "vendor_package_not_found", "Пакет не найден");
      }
      const customer = await getCustomerById(runtime.db, current.customerId);
      if (!customer) {
        throw new ApiError(404, "vendor_customer_not_found", "Клиент не найден");
      }

      const now = new Date();
      const result = await runtime.db.transaction(async (tx) => {
        const txDb = tx as unknown as Database;
        await revokeProvisioningPackage(txDb, current.id, now);
        const issued = await issueProvisioningPackage(txDb, {
          customerId: current.customerId,
          version,
          ttlDays,
          createdBy: identity.userId,
          now,
        });
        const onboarding = await upsertOnboardingSession(txDb, {
          customerId: current.customerId,
          packageId: issued.package.id,
          now,
        });
        await writeVendorAudit(tx, {
          actorId: identity.userId,
          customerId: current.customerId,
          action: "vendor.package.reissued",
          entity: "provisioning_package",
          before: {
            packageId: current.id,
            tokenPrefix: current.tokenPrefix,
            status: current.status,
            version: current.version,
          },
          after: {
            packageId: issued.package.id,
            tokenPrefix: issued.package.tokenPrefix,
            status: issued.package.status,
            version: issued.package.version,
            expiresAt: issued.package.expiresAt.toISOString(),
            onboardingSessionId: onboarding.id,
            reason: input.reason ?? null,
          },
          ip: request.ip || null,
        });
        return issued;
      });

      return reply.status(201).send({
        package: packageResponse(result.package, customer.legalName),
        token: result.token,
      });
    },
  );
}
