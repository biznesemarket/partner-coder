import type { FastifyInstance } from "fastify";

import { getVendorDashboard } from "@partner-coder/db";

import { createVendorGuards } from "../vendor-auth/guard.js";
import type { VendorAuthRuntime } from "../vendor-auth/runtime.js";

const readRoles = ["superadmin", "finance", "support", "readonly"] as const;

export function registerVendorDashboardRoutes(
  server: FastifyInstance,
  runtime: VendorAuthRuntime,
): void {
  const guards = createVendorGuards(runtime);

  server.get(
    "/v1/vendor/dashboard",
    {
      preHandler: [
        guards.authenticateVendor,
        guards.requireVendorMfa,
        guards.requireVendorRole(readRoles),
      ],
    },
    async () => getVendorDashboard(runtime.db),
  );
}
