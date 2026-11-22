import type { FastifyInstance } from "fastify";

import {
  createCustomer,
  createPlan,
  getCustomerById,
  getCustomerByInn,
  getPlanByCode,
  getPlanById,
  listCustomers,
  listPlans,
  updateCustomer,
  updatePlan,
  writeVendorAudit,
  type Customer,
  type Database,
  type Plan,
  type UpdateCustomerInput,
  type VendorContact,
} from "@partner-coder/db";

import { requestClientIp } from "../client-ip.js";
import { ApiError } from "../errors.js";
import {
  vendorCustomerCreateSchema,
  vendorCustomerListQuerySchema,
  vendorCustomerUpdateSchema,
  vendorIdParamsSchema,
  vendorPlanCreateSchema,
  vendorPlanListQuerySchema,
  vendorPlanUpdateSchema,
} from "../openapi/schemas.js";
import { createVendorGuards } from "../vendor-auth/guard.js";
import type { VendorAuthRuntime } from "../vendor-auth/runtime.js";
import { parseBody, parseParams, parseQuery } from "./validation.js";

const readRoles = ["superadmin", "finance", "support", "readonly"] as const;
const writeRoles = ["superadmin"] as const;

function isUniqueViolation(error: unknown): boolean {
  const code =
    (error as { code?: string }).code ?? (error as { cause?: { code?: string } }).cause?.code;
  return code === "23505";
}

function contactValue(contact: {
  readonly name?: string | undefined;
  readonly email?: string | undefined;
  readonly phone?: string | undefined;
  readonly address?: string | undefined;
}): VendorContact {
  const value: {
    name?: string;
    email?: string;
    phone?: string;
    address?: string;
  } = {};
  if (contact.name !== undefined) {
    value.name = contact.name;
  }
  if (contact.email !== undefined) {
    value.email = contact.email;
  }
  if (contact.phone !== undefined) {
    value.phone = contact.phone;
  }
  if (contact.address !== undefined) {
    value.address = contact.address;
  }
  return value;
}

function customerPatch(input: {
  readonly legalName?: string | undefined;
  readonly inn?: string | null | undefined;
  readonly kpp?: string | null | undefined;
  readonly contact?:
    | {
        readonly name?: string | undefined;
        readonly email?: string | undefined;
        readonly phone?: string | undefined;
        readonly address?: string | undefined;
      }
    | undefined;
  readonly status?: Customer["status"] | undefined;
  readonly notes?: string | null | undefined;
}): UpdateCustomerInput {
  const patch: {
    legalName?: string;
    inn?: string | null;
    kpp?: string | null;
    contact?: VendorContact;
    status?: Customer["status"];
    notes?: string | null;
  } = {};
  if (input.legalName !== undefined) {
    patch.legalName = input.legalName;
  }
  if (input.inn !== undefined) {
    patch.inn = input.inn;
  }
  if (input.kpp !== undefined) {
    patch.kpp = input.kpp;
  }
  if (input.contact !== undefined) {
    patch.contact = contactValue(input.contact);
  }
  if (input.status !== undefined) {
    patch.status = input.status;
  }
  if (input.notes !== undefined) {
    patch.notes = input.notes;
  }
  return patch;
}

function customerResponse(customer: Customer) {
  return {
    id: customer.id,
    legalName: customer.legalName,
    inn: customer.inn,
    kpp: customer.kpp,
    contact: customer.contact,
    status: customer.status,
    notes: customer.notes,
    createdAt: customer.createdAt.toISOString(),
    updatedAt: customer.updatedAt.toISOString(),
  };
}

function planResponse(plan: Plan) {
  return {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    priceKopecks: plan.priceKopecks.toString(),
    period: plan.period,
    seatsLimit: plan.seatsLimit,
    projectsLimit: plan.projectsLimit,
    features: plan.features,
    isActive: plan.isActive,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
  };
}

export function registerVendorFinanceRoutes(
  server: FastifyInstance,
  runtime: VendorAuthRuntime,
): void {
  const guards = createVendorGuards(runtime);
  const readGuards = [
    guards.authenticateVendor,
    guards.requireVendorMfa,
    guards.requireVendorRole(readRoles),
  ];
  const writeGuards = [
    guards.authenticateVendor,
    guards.requireVendorMfa,
    guards.requireVendorRole(writeRoles),
  ];

  server.get("/v1/vendor/customers", { preHandler: readGuards }, async (request) => {
    const query = parseQuery(vendorCustomerListQuerySchema, request.query);
    const items = await listCustomers(runtime.db, {
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.query === undefined ? {} : { query: query.query }),
      limit: query.limit,
    });
    return { items: items.map(customerResponse) };
  });

  server.get("/v1/vendor/customers/:id", { preHandler: readGuards }, async (request) => {
    const { id } = parseParams(vendorIdParamsSchema, request.params);
    const customer = await getCustomerById(runtime.db, id);
    if (!customer) {
      throw new ApiError(404, "vendor_customer_not_found", "Клиент не найден");
    }
    return { customer: customerResponse(customer) };
  });

  server.post("/v1/vendor/customers", { preHandler: writeGuards }, async (request, reply) => {
    const identity = request.vendorAuth!;
    const input = parseBody(vendorCustomerCreateSchema, request.body);

    if (input.inn) {
      const existing = await getCustomerByInn(runtime.db, input.inn);
      if (existing) {
        throw new ApiError(409, "vendor_customer_inn_exists", "Клиент с таким ИНН уже существует");
      }
    }

    try {
      const customer = await runtime.db.transaction(async (tx) => {
        const txDb = tx as unknown as Database;
        const created = await createCustomer(txDb, {
          legalName: input.legalName,
          ...(input.inn === undefined ? {} : { inn: input.inn }),
          ...(input.kpp === undefined ? {} : { kpp: input.kpp }),
          ...(input.contact === undefined ? {} : { contact: contactValue(input.contact) }),
          status: input.status,
          ...(input.notes === undefined ? {} : { notes: input.notes }),
        });
        await writeVendorAudit(tx, {
          actorId: identity.userId,
          customerId: created.id,
          action: "vendor.customer.created",
          entity: "customer",
          after: {
            customerId: created.id,
            legalName: created.legalName,
            status: created.status,
          },
          ip: requestClientIp(request),
        });
        return created;
      });

      return reply.status(201).send({ customer: customerResponse(customer) });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApiError(409, "vendor_customer_inn_exists", "Клиент с таким ИНН уже существует");
      }
      throw error;
    }
  });

  server.patch("/v1/vendor/customers/:id", { preHandler: writeGuards }, async (request) => {
    const identity = request.vendorAuth!;
    const { id } = parseParams(vendorIdParamsSchema, request.params);
    const input = parseBody(vendorCustomerUpdateSchema, request.body);
    if (Object.keys(input).length === 0) {
      throw new ApiError(400, "validation_error", "Некорректные данные запроса");
    }

    const current = await getCustomerById(runtime.db, id);
    if (!current) {
      throw new ApiError(404, "vendor_customer_not_found", "Клиент не найден");
    }

    if (typeof input.inn === "string") {
      const existing = await getCustomerByInn(runtime.db, input.inn);
      if (existing && existing.id !== id) {
        throw new ApiError(409, "vendor_customer_inn_exists", "Клиент с таким ИНН уже существует");
      }
    }

    try {
      const updated = await runtime.db.transaction(async (tx) => {
        const txDb = tx as unknown as Database;
        const customer = await updateCustomer(txDb, id, customerPatch(input));
        if (!customer) {
          return null;
        }
        if (customer.status !== current.status || customer.legalName !== current.legalName) {
          await writeVendorAudit(tx, {
            actorId: identity.userId,
            customerId: customer.id,
            action: "vendor.customer.updated",
            entity: "customer",
            before: { status: current.status, legalName: current.legalName },
            after: {
              customerId: customer.id,
              status: customer.status,
              legalName: customer.legalName,
            },
            ip: requestClientIp(request),
          });
        }
        return customer;
      });

      if (!updated) {
        throw new ApiError(404, "vendor_customer_not_found", "Клиент не найден");
      }
      return { customer: customerResponse(updated) };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApiError(409, "vendor_customer_inn_exists", "Клиент с таким ИНН уже существует");
      }
      throw error;
    }
  });

  server.get("/v1/vendor/plans", { preHandler: readGuards }, async (request) => {
    const query = parseQuery(vendorPlanListQuerySchema, request.query);
    const items = await listPlans(runtime.db, {
      ...(query.activeOnly === undefined ? {} : { activeOnly: query.activeOnly }),
      ...(query.query === undefined ? {} : { query: query.query }),
      limit: query.limit,
    });
    return { items: items.map(planResponse) };
  });

  server.post("/v1/vendor/plans", { preHandler: writeGuards }, async (request, reply) => {
    const identity = request.vendorAuth!;
    const input = parseBody(vendorPlanCreateSchema, request.body);

    const existing = await getPlanByCode(runtime.db, input.code);
    if (existing) {
      throw new ApiError(409, "vendor_plan_code_exists", "Тариф с таким кодом уже существует");
    }

    try {
      const plan = await runtime.db.transaction(async (tx) => {
        const txDb = tx as unknown as Database;
        const created = await createPlan(txDb, {
          code: input.code,
          name: input.name,
          priceKopecks: BigInt(input.priceKopecks),
          period: input.period,
          seatsLimit: input.seatsLimit,
          projectsLimit: input.projectsLimit,
          features: input.features,
          isActive: input.isActive,
        });
        await writeVendorAudit(tx, {
          actorId: identity.userId,
          action: "vendor.plan.created",
          entity: "plan",
          after: {
            planId: created.id,
            code: created.code,
            priceKopecks: created.priceKopecks.toString(),
            isActive: created.isActive,
          },
          ip: requestClientIp(request),
        });
        return created;
      });

      return reply.status(201).send({ plan: planResponse(plan) });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApiError(409, "vendor_plan_code_exists", "Тариф с таким кодом уже существует");
      }
      throw error;
    }
  });

  server.patch("/v1/vendor/plans/:id", { preHandler: writeGuards }, async (request) => {
    const identity = request.vendorAuth!;
    const { id } = parseParams(vendorIdParamsSchema, request.params);
    const input = parseBody(vendorPlanUpdateSchema, request.body);
    if (Object.keys(input).length === 0) {
      throw new ApiError(400, "validation_error", "Некорректные данные запроса");
    }

    const current = await getPlanById(runtime.db, id);
    if (!current) {
      throw new ApiError(404, "vendor_plan_not_found", "Тариф не найден");
    }

    const updated = await runtime.db.transaction(async (tx) => {
      const txDb = tx as unknown as Database;
      const plan = await updatePlan(txDb, id, {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.priceKopecks === undefined ? {} : { priceKopecks: BigInt(input.priceKopecks) }),
        ...(input.period === undefined ? {} : { period: input.period }),
        ...(input.seatsLimit === undefined ? {} : { seatsLimit: input.seatsLimit }),
        ...(input.projectsLimit === undefined ? {} : { projectsLimit: input.projectsLimit }),
        ...(input.features === undefined ? {} : { features: input.features }),
        ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      });
      if (!plan) {
        return null;
      }
      await writeVendorAudit(tx, {
        actorId: identity.userId,
        action: "vendor.plan.updated",
        entity: "plan",
        before: {
          priceKopecks: current.priceKopecks.toString(),
          isActive: current.isActive,
        },
        after: {
          planId: plan.id,
          code: plan.code,
          priceKopecks: plan.priceKopecks.toString(),
          isActive: plan.isActive,
        },
        ip: requestClientIp(request),
      });
      return plan;
    });

    if (!updated) {
      throw new ApiError(404, "vendor_plan_not_found", "Тариф не найден");
    }
    return { plan: planResponse(updated) };
  });
}
