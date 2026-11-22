import { addLocalDays } from "@partner-coder/domain";
import type { FastifyInstance } from "fastify";

import {
  createContract,
  createDiscount,
  createInvoice,
  createPayment,
  createSubscription,
  findOverlappingDiscount,
  getContractById,
  getCustomerById,
  getInvoiceById,
  getPlanById,
  getSubscriptionById,
  listContracts,
  listDiscounts,
  listInvoices,
  listPayments,
  listSubscriptions,
  renewSubscription,
  updateCustomer,
  updateInvoice,
  updateSubscriptionStatus,
  writeVendorAudit,
  type Contract,
  type Customer,
  type Database,
  type Invoice,
  type PaymentWithInvoice,
  type Plan,
  type Subscription,
  type SubscriptionDiscount,
} from "@partner-coder/db";

import { requestClientIp } from "../client-ip.js";
import { ApiError } from "../errors.js";
import {
  vendorContractCreateSchema,
  vendorContractListQuerySchema,
  vendorCustomerResumeSchema,
  vendorCustomerSuspendSchema,
  vendorDiscountCreateSchema,
  vendorIdParamsSchema,
  vendorInvoiceCreateSchema,
  vendorInvoiceListQuerySchema,
  vendorInvoiceUpdateSchema,
  vendorPaymentCreateSchema,
  vendorPaymentListQuerySchema,
  vendorSubscriptionCreateSchema,
  vendorSubscriptionListQuerySchema,
  vendorSubscriptionRenewSchema,
  vendorSubscriptionStatusUpdateSchema,
} from "../openapi/schemas.js";
import { createVendorGuards } from "../vendor-auth/guard.js";
import type { VendorAuthRuntime } from "../vendor-auth/runtime.js";
import { parseBody, parseParams, parseQuery } from "./validation.js";

const readRoles = ["superadmin", "finance", "support", "readonly"] as const;
const adminRoles = ["superadmin"] as const;
const financeRoles = ["finance"] as const;

const CUSTOMER_LIFECYCLE_STATUSES = new Set<Customer["status"]>([
  "trial",
  "active",
  "grace",
  "expired",
  "suspended",
]);

const MANUAL_SUBSCRIPTION_TRANSITIONS: Record<
  Subscription["status"],
  readonly ("active" | "grace" | "expired")[]
> = {
  trial: ["active", "expired"],
  active: ["grace"],
  grace: ["active", "expired"],
  expired: ["active"],
  suspended: [],
  cancelled: [],
};

function isUniqueViolation(error: unknown): boolean {
  const code =
    (error as { code?: string }).code ?? (error as { cause?: { code?: string } }).cause?.code;
  return code === "23505";
}

function contractResponse(contract: Contract) {
  return {
    id: contract.id,
    customerId: contract.customerId,
    planId: contract.planId,
    number: contract.number,
    startsOn: contract.startsOn,
    endsOn: contract.endsOn,
    limits: contract.limits,
    status: contract.status,
    createdAt: contract.createdAt.toISOString(),
    updatedAt: contract.updatedAt.toISOString(),
  };
}

function subscriptionResponse(subscription: Subscription) {
  return {
    id: subscription.id,
    customerId: subscription.customerId,
    contractId: subscription.contractId,
    status: subscription.status,
    periodStart: subscription.periodStart,
    periodEnd: subscription.periodEnd,
    graceUntil: subscription.graceUntil?.toISOString() ?? null,
    statusChangedAt: subscription.statusChangedAt.toISOString(),
    seats: subscription.seats,
    projectsLimit: subscription.projectsLimit,
    createdAt: subscription.createdAt.toISOString(),
    updatedAt: subscription.updatedAt.toISOString(),
  };
}

function discountResponse(discount: SubscriptionDiscount) {
  return {
    id: discount.id,
    subscriptionId: discount.subscriptionId,
    percentBp: discount.percentBp,
    startsOn: discount.startsOn,
    endsOn: discount.endsOn,
    note: discount.note,
    createdBy: discount.createdBy,
    createdAt: discount.createdAt.toISOString(),
  };
}

function invoiceResponse(invoice: Invoice) {
  return {
    id: invoice.id,
    customerId: invoice.customerId,
    contractId: invoice.contractId,
    number: invoice.number,
    issuedOn: invoice.issuedOn,
    dueOn: invoice.dueOn,
    amountKopecks: invoice.amountKopecks.toString(),
    status: invoice.status,
    pdfUrl: invoice.pdfUrl,
    createdAt: invoice.createdAt.toISOString(),
    updatedAt: invoice.updatedAt.toISOString(),
  };
}

function paymentResponse(payment: PaymentWithInvoice) {
  return {
    id: payment.id,
    invoiceId: payment.invoiceId,
    invoiceNumber: payment.invoiceNumber,
    customerId: payment.customerId,
    customerLegalName: payment.customerLegalName,
    paidOn: payment.paidOn,
    amountKopecks: payment.amountKopecks.toString(),
    method: payment.method,
    reference: payment.reference,
    recordedBy: payment.recordedBy,
    createdAt: payment.createdAt.toISOString(),
  };
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

function assertContractPlan(plan: Plan | null): Plan {
  if (!plan) {
    throw new ApiError(404, "vendor_plan_not_found", "Тариф не найден");
  }
  return plan;
}

async function syncCustomerStatus(
  tx: Database,
  customerId: string,
  status: Subscription["status"],
): Promise<void> {
  if (!CUSTOMER_LIFECYCLE_STATUSES.has(status as Customer["status"])) {
    return;
  }
  const customer = await getCustomerById(tx, customerId);
  if (!customer || !CUSTOMER_LIFECYCLE_STATUSES.has(customer.status)) {
    return;
  }
  await updateCustomer(tx, customerId, { status: status as Customer["status"] });
}

export function registerVendorBillingRoutes(
  server: FastifyInstance,
  runtime: VendorAuthRuntime,
): void {
  const guards = createVendorGuards(runtime);
  const readGuards = [
    guards.authenticateVendor,
    guards.requireVendorMfa,
    guards.requireVendorRole(readRoles),
  ];
  const adminWriteGuards = [
    guards.authenticateVendor,
    guards.requireVendorMfa,
    guards.requireVendorRole(adminRoles),
  ];
  const adminStepUpGuards = [...adminWriteGuards, guards.requireVendorStepUp];
  const financeStepUpGuards = [
    guards.authenticateVendor,
    guards.requireVendorMfa,
    guards.requireVendorRole(financeRoles),
    guards.requireVendorStepUp,
  ];

  server.get("/v1/vendor/contracts", { preHandler: readGuards }, async (request) => {
    const query = parseQuery(vendorContractListQuerySchema, request.query);
    const items = await listContracts(runtime.db, {
      ...(query.customerId === undefined ? {} : { customerId: query.customerId }),
      ...(query.status === undefined ? {} : { status: query.status }),
      limit: query.limit,
    });
    return { items: items.map(contractResponse) };
  });

  server.post("/v1/vendor/contracts", { preHandler: adminWriteGuards }, async (request, reply) => {
    const identity = request.vendorAuth!;
    const input = parseBody(vendorContractCreateSchema, request.body);

    const customer = await getCustomerById(runtime.db, input.customerId);
    const plan = await getPlanById(runtime.db, input.planId);
    if (!customer) {
      throw new ApiError(404, "vendor_customer_not_found", "Клиент не найден");
    }
    assertContractPlan(plan);

    try {
      const contract = await runtime.db.transaction(async (tx) => {
        const created = await createContract(tx as unknown as Database, {
          customerId: input.customerId,
          planId: input.planId,
          number: input.number,
          startsOn: input.startsOn,
          endsOn: input.endsOn ?? null,
          ...(input.limits === undefined ? {} : { limits: input.limits }),
          status: input.status,
        });
        await writeVendorAudit(tx, {
          actorId: identity.userId,
          customerId: created.customerId,
          action: "vendor.contract.created",
          entity: "contract",
          after: {
            contractId: created.id,
            customerId: created.customerId,
            planId: created.planId,
            number: created.number,
            status: created.status,
          },
          ip: requestClientIp(request),
        });
        return created;
      });

      return reply.status(201).send({ contract: contractResponse(contract) });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApiError(
          409,
          "vendor_contract_number_exists",
          "Договор с таким номером уже существует",
        );
      }
      throw error;
    }
  });

  server.get("/v1/vendor/subscriptions", { preHandler: readGuards }, async (request) => {
    const query = parseQuery(vendorSubscriptionListQuerySchema, request.query);
    const items = await listSubscriptions(runtime.db, {
      ...(query.customerId === undefined ? {} : { customerId: query.customerId }),
      ...(query.status === undefined ? {} : { status: query.status }),
      limit: query.limit,
    });
    return { items: items.map(subscriptionResponse) };
  });

  server.post(
    "/v1/vendor/subscriptions",
    { preHandler: adminWriteGuards },
    async (request, reply) => {
      const identity = request.vendorAuth!;
      const input = parseBody(vendorSubscriptionCreateSchema, request.body);

      const customer = await getCustomerById(runtime.db, input.customerId);
      const contract = await getContractById(runtime.db, input.contractId);
      if (!customer) {
        throw new ApiError(404, "vendor_customer_not_found", "Клиент не найден");
      }
      if (!contract) {
        throw new ApiError(404, "vendor_contract_not_found", "Договор не найден");
      }
      if (contract.customerId !== input.customerId) {
        throw new ApiError(
          400,
          "vendor_contract_customer_mismatch",
          "Договор принадлежит другому клиенту",
        );
      }
      const plan = assertContractPlan(await getPlanById(runtime.db, contract.planId));

      const subscription = await runtime.db.transaction(async (tx) => {
        const created = await createSubscription(tx as unknown as Database, {
          customerId: input.customerId,
          contractId: input.contractId,
          status: input.status,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          seats: input.seats ?? plan.seatsLimit,
          projectsLimit: input.projectsLimit ?? plan.projectsLimit,
        });
        await writeVendorAudit(tx, {
          actorId: identity.userId,
          customerId: created.customerId,
          action: "vendor.subscription.created",
          entity: "subscription",
          after: {
            subscriptionId: created.id,
            customerId: created.customerId,
            contractId: created.contractId,
            status: created.status,
            periodStart: created.periodStart,
            periodEnd: created.periodEnd,
          },
          ip: requestClientIp(request),
        });
        return created;
      });

      return reply.status(201).send({ subscription: subscriptionResponse(subscription) });
    },
  );

  server.post(
    "/v1/vendor/subscriptions/:id/renew",
    { preHandler: financeStepUpGuards },
    async (request) => {
      const identity = request.vendorAuth!;
      const { id } = parseParams(vendorIdParamsSchema, request.params);
      const input = parseBody(vendorSubscriptionRenewSchema, request.body);
      const current = await getSubscriptionById(runtime.db, id);
      if (!current) {
        throw new ApiError(404, "vendor_subscription_not_found", "Подписка не найдена");
      }
      if (current.status === "suspended" || current.status === "cancelled") {
        throw new ApiError(
          409,
          "vendor_subscription_inactive",
          "Подписку нужно сначала восстановить решением суперадминистратора",
        );
      }

      const changedAt = new Date();
      const updated = await runtime.db.transaction(async (tx) => {
        const txDb = tx as unknown as Database;
        const subscription = await renewSubscription(txDb, id, {
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          changedAt,
        });
        if (!subscription) {
          return null;
        }
        await syncCustomerStatus(txDb, subscription.customerId, subscription.status);
        await writeVendorAudit(tx, {
          actorId: identity.userId,
          customerId: subscription.customerId,
          action: "vendor.subscription.renewed",
          entity: "subscription",
          before: {
            status: current.status,
            periodStart: current.periodStart,
            periodEnd: current.periodEnd,
          },
          after: {
            subscriptionId: subscription.id,
            status: subscription.status,
            periodStart: subscription.periodStart,
            periodEnd: subscription.periodEnd,
          },
          ip: requestClientIp(request),
        });
        return subscription;
      });

      if (!updated) {
        throw new ApiError(404, "vendor_subscription_not_found", "Подписка не найдена");
      }
      return { subscription: subscriptionResponse(updated) };
    },
  );

  server.post(
    "/v1/vendor/subscriptions/:id/status",
    { preHandler: financeStepUpGuards },
    async (request) => {
      const identity = request.vendorAuth!;
      const { id } = parseParams(vendorIdParamsSchema, request.params);
      const input = parseBody(vendorSubscriptionStatusUpdateSchema, request.body);
      const current = await getSubscriptionById(runtime.db, id);
      if (!current) {
        throw new ApiError(404, "vendor_subscription_not_found", "Подписка не найдена");
      }
      if (current.status === "suspended" || current.status === "cancelled") {
        throw new ApiError(
          409,
          "vendor_subscription_status_locked",
          "Статус меняет суперадминистратор через карточку клиента",
        );
      }
      if (current.status === input.status) {
        throw new ApiError(409, "vendor_subscription_status_same", "Статус уже установлен");
      }
      if (!MANUAL_SUBSCRIPTION_TRANSITIONS[current.status].includes(input.status)) {
        throw new ApiError(
          409,
          "vendor_subscription_transition_denied",
          "Этот переход статуса не предусмотрен правилами",
        );
      }

      const graceUntil =
        input.status === "grace"
          ? new Date(input.graceUntil ?? `${addLocalDays(current.periodEnd, 7)}T00:00:00.000Z`)
          : null;
      const changedAt = new Date();
      const updated = await runtime.db.transaction(async (tx) => {
        const txDb = tx as unknown as Database;
        const subscription = await updateSubscriptionStatus(txDb, id, {
          status: input.status,
          graceUntil,
          changedAt,
        });
        if (!subscription) {
          return null;
        }
        await syncCustomerStatus(txDb, subscription.customerId, subscription.status);
        await writeVendorAudit(tx, {
          actorId: identity.userId,
          customerId: subscription.customerId,
          action: "vendor.subscription.status_changed",
          entity: "subscription",
          before: { status: current.status, graceUntil: current.graceUntil?.toISOString() ?? null },
          after: {
            subscriptionId: subscription.id,
            status: subscription.status,
            graceUntil: subscription.graceUntil?.toISOString() ?? null,
            reason: input.reason ?? null,
          },
          ip: requestClientIp(request),
        });
        return subscription;
      });

      if (!updated) {
        throw new ApiError(404, "vendor_subscription_not_found", "Подписка не найдена");
      }
      return { subscription: subscriptionResponse(updated) };
    },
  );

  server.get(
    "/v1/vendor/subscriptions/:id/discounts",
    { preHandler: readGuards },
    async (request) => {
      const { id } = parseParams(vendorIdParamsSchema, request.params);
      const subscription = await getSubscriptionById(runtime.db, id);
      if (!subscription) {
        throw new ApiError(404, "vendor_subscription_not_found", "Подписка не найдена");
      }
      const items = await listDiscounts(runtime.db, id);
      return { items: items.map(discountResponse) };
    },
  );

  server.post(
    "/v1/vendor/subscriptions/:id/discounts",
    { preHandler: adminStepUpGuards },
    async (request, reply) => {
      const identity = request.vendorAuth!;
      const { id } = parseParams(vendorIdParamsSchema, request.params);
      const input = parseBody(vendorDiscountCreateSchema, request.body);
      const subscription = await getSubscriptionById(runtime.db, id);
      if (!subscription) {
        throw new ApiError(404, "vendor_subscription_not_found", "Подписка не найдена");
      }

      const overlap = await findOverlappingDiscount(
        runtime.db,
        id,
        input.startsOn,
        input.endsOn ?? null,
      );
      if (overlap) {
        throw new ApiError(409, "vendor_discount_overlap", "На этот период уже назначена скидка");
      }

      const discount = await runtime.db.transaction(async (tx) => {
        const created = await createDiscount(tx as unknown as Database, {
          subscriptionId: id,
          percentBp: input.percentBp,
          startsOn: input.startsOn,
          endsOn: input.endsOn ?? null,
          note: input.note ?? null,
          createdBy: identity.userId,
        });
        await writeVendorAudit(tx, {
          actorId: identity.userId,
          customerId: subscription.customerId,
          action: "vendor.discount.assigned",
          entity: "subscription_discount",
          after: {
            discountId: created.id,
            subscriptionId: created.subscriptionId,
            percentBp: created.percentBp,
            startsOn: created.startsOn,
            endsOn: created.endsOn,
            note: created.note,
          },
          ip: requestClientIp(request),
        });
        return created;
      });

      return reply.status(201).send({ discount: discountResponse(discount) });
    },
  );

  server.get("/v1/vendor/invoices", { preHandler: readGuards }, async (request) => {
    const query = parseQuery(vendorInvoiceListQuerySchema, request.query);
    const items = await listInvoices(runtime.db, {
      ...(query.customerId === undefined ? {} : { customerId: query.customerId }),
      ...(query.status === undefined ? {} : { status: query.status }),
      limit: query.limit,
    });
    return { items: items.map(invoiceResponse) };
  });

  server.post(
    "/v1/vendor/invoices",
    { preHandler: financeStepUpGuards },
    async (request, reply) => {
      const identity = request.vendorAuth!;
      const input = parseBody(vendorInvoiceCreateSchema, request.body);
      if (BigInt(input.amountKopecks) <= 0n) {
        throw new ApiError(400, "validation_error", "Сумма счёта должна быть больше нуля");
      }

      const customer = await getCustomerById(runtime.db, input.customerId);
      const contract = await getContractById(runtime.db, input.contractId);
      if (!customer) {
        throw new ApiError(404, "vendor_customer_not_found", "Клиент не найден");
      }
      if (!contract) {
        throw new ApiError(404, "vendor_contract_not_found", "Договор не найден");
      }
      if (contract.customerId !== input.customerId) {
        throw new ApiError(
          400,
          "vendor_contract_customer_mismatch",
          "Договор принадлежит другому клиенту",
        );
      }

      try {
        const invoice = await runtime.db.transaction(async (tx) => {
          const created = await createInvoice(tx as unknown as Database, {
            customerId: input.customerId,
            contractId: input.contractId,
            number: input.number,
            issuedOn: input.issuedOn,
            dueOn: input.dueOn,
            amountKopecks: BigInt(input.amountKopecks),
            status: input.status,
            pdfUrl: input.pdfUrl ?? null,
          });
          await writeVendorAudit(tx, {
            actorId: identity.userId,
            customerId: created.customerId,
            action: "vendor.invoice.created",
            entity: "invoice",
            after: {
              invoiceId: created.id,
              number: created.number,
              status: created.status,
              amountKopecks: created.amountKopecks.toString(),
              issuedOn: created.issuedOn,
              dueOn: created.dueOn,
            },
            ip: requestClientIp(request),
          });
          return created;
        });

        return reply.status(201).send({ invoice: invoiceResponse(invoice) });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ApiError(
            409,
            "vendor_invoice_number_exists",
            "Счёт с таким номером уже существует",
          );
        }
        throw error;
      }
    },
  );

  server.patch("/v1/vendor/invoices/:id", { preHandler: financeStepUpGuards }, async (request) => {
    const identity = request.vendorAuth!;
    const { id } = parseParams(vendorIdParamsSchema, request.params);
    const input = parseBody(vendorInvoiceUpdateSchema, request.body);
    if (Object.keys(input).length === 0) {
      throw new ApiError(400, "validation_error", "Некорректные данные запроса");
    }
    const current = await getInvoiceById(runtime.db, id);
    if (!current) {
      throw new ApiError(404, "vendor_invoice_not_found", "Счёт не найден");
    }

    const updated = await runtime.db.transaction(async (tx) => {
      const invoice = await updateInvoice(tx as unknown as Database, id, {
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.pdfUrl === undefined ? {} : { pdfUrl: input.pdfUrl }),
      });
      if (!invoice) {
        return null;
      }
      await writeVendorAudit(tx, {
        actorId: identity.userId,
        customerId: invoice.customerId,
        action: "vendor.invoice.updated",
        entity: "invoice",
        before: { status: current.status, pdfUrl: current.pdfUrl },
        after: {
          invoiceId: invoice.id,
          status: invoice.status,
          pdfUrl: invoice.pdfUrl,
        },
        ip: requestClientIp(request),
      });
      return invoice;
    });

    if (!updated) {
      throw new ApiError(404, "vendor_invoice_not_found", "Счёт не найден");
    }
    return { invoice: invoiceResponse(updated) };
  });

  server.get("/v1/vendor/payments", { preHandler: readGuards }, async (request) => {
    const query = parseQuery(vendorPaymentListQuerySchema, request.query);
    const items = await listPayments(runtime.db, {
      ...(query.invoiceId === undefined ? {} : { invoiceId: query.invoiceId }),
      ...(query.customerId === undefined ? {} : { customerId: query.customerId }),
      limit: query.limit,
    });
    return { items: items.map(paymentResponse) };
  });

  server.post(
    "/v1/vendor/payments",
    { preHandler: financeStepUpGuards },
    async (request, reply) => {
      const identity = request.vendorAuth!;
      const input = parseBody(vendorPaymentCreateSchema, request.body);
      const invoice = await getInvoiceById(runtime.db, input.invoiceId);
      if (!invoice) {
        throw new ApiError(404, "vendor_invoice_not_found", "Счёт не найден");
      }
      if (invoice.status === "draft" || invoice.status === "void") {
        throw new ApiError(
          409,
          "vendor_invoice_not_payable",
          "По черновику или отменённому счёту нельзя внести платёж",
        );
      }
      const customer = await getCustomerById(runtime.db, invoice.customerId);
      if (!customer) {
        throw new ApiError(404, "vendor_customer_not_found", "Клиент не найден");
      }

      const payment = await runtime.db.transaction(async (tx) => {
        const created = await createPayment(tx as unknown as Database, {
          invoiceId: input.invoiceId,
          paidOn: input.paidOn,
          amountKopecks: BigInt(input.amountKopecks),
          method: input.method,
          reference: input.reference ?? null,
          recordedBy: identity.userId,
        });
        await writeVendorAudit(tx, {
          actorId: identity.userId,
          customerId: invoice.customerId,
          action: "vendor.payment.recorded",
          entity: "payment",
          after: {
            paymentId: created.id,
            invoiceId: created.invoiceId,
            invoiceNumber: invoice.number,
            amountKopecks: created.amountKopecks.toString(),
            method: created.method,
            paidOn: created.paidOn,
          },
          ip: requestClientIp(request),
        });
        return created;
      });

      return reply.status(201).send({
        payment: paymentResponse({
          ...payment,
          invoiceNumber: invoice.number,
          customerId: invoice.customerId,
          customerLegalName: customer.legalName,
        }),
      });
    },
  );

  server.post(
    "/v1/vendor/customers/:id/suspend",
    { preHandler: adminStepUpGuards },
    async (request) => {
      const identity = request.vendorAuth!;
      const { id } = parseParams(vendorIdParamsSchema, request.params);
      const input = parseBody(vendorCustomerSuspendSchema, request.body ?? {});
      const current = await getCustomerById(runtime.db, id);
      if (!current) {
        throw new ApiError(404, "vendor_customer_not_found", "Клиент не найден");
      }

      const now = new Date();
      const customer = await runtime.db.transaction(async (tx) => {
        const txDb = tx as unknown as Database;
        const subscriptions = await listSubscriptions(txDb, { customerId: id, limit: 500 });
        const changed: string[] = [];
        for (const subscription of subscriptions) {
          if (subscription.status === "suspended" || subscription.status === "cancelled") {
            continue;
          }
          const updated = await updateSubscriptionStatus(txDb, subscription.id, {
            status: "suspended",
            graceUntil: null,
            changedAt: now,
          });
          if (updated) {
            changed.push(updated.id);
          }
        }
        const updatedCustomer = await updateCustomer(txDb, id, { status: "suspended" });
        if (!updatedCustomer) {
          return null;
        }
        await writeVendorAudit(tx, {
          actorId: identity.userId,
          customerId: id,
          action: "vendor.customer.suspended",
          entity: "customer",
          before: { status: current.status },
          after: {
            customerId: id,
            status: updatedCustomer.status,
            subscriptionIds: changed,
            reason: input.reason ?? null,
          },
          ip: requestClientIp(request),
        });
        return updatedCustomer;
      });

      if (!customer) {
        throw new ApiError(404, "vendor_customer_not_found", "Клиент не найден");
      }
      return { customer: customerResponse(customer) };
    },
  );

  server.post(
    "/v1/vendor/customers/:id/resume",
    { preHandler: adminStepUpGuards },
    async (request) => {
      const identity = request.vendorAuth!;
      const { id } = parseParams(vendorIdParamsSchema, request.params);
      const input = parseBody(vendorCustomerResumeSchema, request.body ?? {});
      const current = await getCustomerById(runtime.db, id);
      if (!current) {
        throw new ApiError(404, "vendor_customer_not_found", "Клиент не найден");
      }

      const now = new Date();
      const customer = await runtime.db.transaction(async (tx) => {
        const txDb = tx as unknown as Database;
        const subscriptions = await listSubscriptions(txDb, {
          customerId: id,
          status: "suspended",
          limit: 500,
        });
        const changed: string[] = [];
        for (const subscription of subscriptions) {
          const updated =
            input.periodStart !== undefined && input.periodEnd !== undefined
              ? await renewSubscription(txDb, subscription.id, {
                  periodStart: input.periodStart,
                  periodEnd: input.periodEnd,
                  changedAt: now,
                })
              : await updateSubscriptionStatus(txDb, subscription.id, {
                  status: "active",
                  graceUntil: null,
                  changedAt: now,
                });
          if (updated) {
            changed.push(updated.id);
          }
        }
        const updatedCustomer = await updateCustomer(txDb, id, { status: "active" });
        if (!updatedCustomer) {
          return null;
        }
        await writeVendorAudit(tx, {
          actorId: identity.userId,
          customerId: id,
          action: "vendor.customer.resumed",
          entity: "customer",
          before: { status: current.status },
          after: {
            customerId: id,
            status: updatedCustomer.status,
            subscriptionIds: changed,
            periodStart: input.periodStart ?? null,
            periodEnd: input.periodEnd ?? null,
            reason: input.reason ?? null,
          },
          ip: requestClientIp(request),
        });
        return updatedCustomer;
      });

      if (!customer) {
        throw new ApiError(404, "vendor_customer_not_found", "Клиент не найден");
      }
      return { customer: customerResponse(customer) };
    },
  );
}
