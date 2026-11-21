import { z } from "zod";

import {
  acceptInvitationResponseSchema,
  authMeResponseSchema,
  deviceIssuedResponseSchema,
  deviceListResponseSchema,
  deviceCreateSchema,
  errorEnvelopeSchema,
  healthResponseSchema,
  invitationCreateResponseSchema,
  invitationCreateSchema,
  invitationListResponseSchema,
  publicInvitationResponseSchema,
  readyResponseSchema,
  tenantDaysResponseSchema,
  tenantIdBodySchema,
  tenantMembersResponseSchema,
  tenantOverviewResponseSchema,
  tenantProjectsResponseSchema,
  tenantSwitchResponseSchema,
  vendorAuthMeResponseSchema,
  vendorContractCreateSchema,
  vendorContractListResponseSchema,
  vendorContractResponseSchema,
  vendorContractSchema,
  vendorCustomerCreateSchema,
  vendorCustomerListResponseSchema,
  vendorCustomerResponseSchema,
  vendorCustomerSchema,
  vendorCustomerResumeSchema,
  vendorCustomerSuspendSchema,
  vendorCustomerUpdateSchema,
  vendorDiscountCreateSchema,
  vendorDiscountListResponseSchema,
  vendorDiscountResponseSchema,
  vendorDiscountSchema,
  vendorInvoiceCreateSchema,
  vendorInvoiceListResponseSchema,
  vendorInvoiceResponseSchema,
  vendorInvoiceSchema,
  vendorInvoiceUpdateSchema,
  vendorMfaResetResponseSchema,
  vendorPasswordResetResponseSchema,
  vendorPaymentCreateSchema,
  vendorPaymentListResponseSchema,
  vendorPaymentResponseSchema,
  vendorPaymentSchema,
  vendorPlanCreateSchema,
  vendorPlanListResponseSchema,
  vendorPlanResponseSchema,
  vendorPlanSchema,
  vendorPlanUpdateSchema,
  vendorStepUpResponseSchema,
  vendorSubscriptionCreateSchema,
  vendorSubscriptionListResponseSchema,
  vendorSubscriptionRenewSchema,
  vendorSubscriptionResponseSchema,
  vendorSubscriptionSchema,
  vendorSubscriptionStatusUpdateSchema,
  vendorStepUpSchema,
  vendorUserCreateSchema,
  vendorUserListResponseSchema,
  vendorUserResponseSchema,
  vendorUserSchema,
  vendorUserUpdateSchema,
} from "./schemas.js";

type JsonSchema = Record<string, unknown>;

const schemaRef = (name: string): JsonSchema => ({ $ref: `#/components/schemas/${name}` });

const jsonContent = (schema: JsonSchema): Record<string, unknown> => ({
  "application/json": { schema },
});

const errorResponse = (description: string): Record<string, unknown> => ({
  description,
  content: jsonContent(schemaRef("ErrorEnvelope")),
});

function toJsonSchema(schema: z.ZodType): JsonSchema {
  const generated = z.toJSONSchema(schema, { target: "draft-2020-12" }) as JsonSchema;
  const { $schema: _ignored, ...rest } = generated;
  return rest;
}

function componentSchemas(): Record<string, JsonSchema> {
  return Object.fromEntries(
    Object.entries({
      ErrorEnvelope: errorEnvelopeSchema,
      HealthResponse: healthResponseSchema,
      ReadyResponse: readyResponseSchema,
      TenantIdBody: tenantIdBodySchema,
      InvitationCreate: invitationCreateSchema,
      InvitationCreateResponse: invitationCreateResponseSchema,
      InvitationListResponse: invitationListResponseSchema,
      PublicInvitationResponse: publicInvitationResponseSchema,
      AcceptInvitationResponse: acceptInvitationResponseSchema,
      AuthMeResponse: authMeResponseSchema,
      TenantSwitchResponse: tenantSwitchResponseSchema,
      DeviceListResponse: deviceListResponseSchema,
      DeviceIssuedResponse: deviceIssuedResponseSchema,
      DeviceCreate: deviceCreateSchema,
      TenantOverviewResponse: tenantOverviewResponseSchema,
      TenantMembersResponse: tenantMembersResponseSchema,
      TenantProjectsResponse: tenantProjectsResponseSchema,
      TenantDaysResponse: tenantDaysResponseSchema,
      VendorUser: vendorUserSchema,
      VendorUserResponse: vendorUserResponseSchema,
      VendorUserListResponse: vendorUserListResponseSchema,
      VendorUserCreate: vendorUserCreateSchema,
      VendorUserUpdate: vendorUserUpdateSchema,
      VendorAuthMeResponse: vendorAuthMeResponseSchema,
      VendorStepUpRequest: vendorStepUpSchema,
      VendorStepUpResponse: vendorStepUpResponseSchema,
      VendorPasswordResetResponse: vendorPasswordResetResponseSchema,
      VendorMfaResetResponse: vendorMfaResetResponseSchema,
      VendorCustomer: vendorCustomerSchema,
      VendorCustomerCreate: vendorCustomerCreateSchema,
      VendorCustomerUpdate: vendorCustomerUpdateSchema,
      VendorCustomerResponse: vendorCustomerResponseSchema,
      VendorCustomerListResponse: vendorCustomerListResponseSchema,
      VendorPlan: vendorPlanSchema,
      VendorPlanCreate: vendorPlanCreateSchema,
      VendorPlanUpdate: vendorPlanUpdateSchema,
      VendorPlanResponse: vendorPlanResponseSchema,
      VendorPlanListResponse: vendorPlanListResponseSchema,
      VendorContract: vendorContractSchema,
      VendorContractCreate: vendorContractCreateSchema,
      VendorContractResponse: vendorContractResponseSchema,
      VendorContractListResponse: vendorContractListResponseSchema,
      VendorSubscription: vendorSubscriptionSchema,
      VendorSubscriptionCreate: vendorSubscriptionCreateSchema,
      VendorSubscriptionResponse: vendorSubscriptionResponseSchema,
      VendorSubscriptionListResponse: vendorSubscriptionListResponseSchema,
      VendorSubscriptionRenew: vendorSubscriptionRenewSchema,
      VendorSubscriptionStatusUpdate: vendorSubscriptionStatusUpdateSchema,
      VendorDiscount: vendorDiscountSchema,
      VendorDiscountCreate: vendorDiscountCreateSchema,
      VendorDiscountResponse: vendorDiscountResponseSchema,
      VendorDiscountListResponse: vendorDiscountListResponseSchema,
      VendorInvoice: vendorInvoiceSchema,
      VendorInvoiceCreate: vendorInvoiceCreateSchema,
      VendorInvoiceUpdate: vendorInvoiceUpdateSchema,
      VendorInvoiceResponse: vendorInvoiceResponseSchema,
      VendorInvoiceListResponse: vendorInvoiceListResponseSchema,
      VendorPayment: vendorPaymentSchema,
      VendorPaymentCreate: vendorPaymentCreateSchema,
      VendorPaymentResponse: vendorPaymentResponseSchema,
      VendorPaymentListResponse: vendorPaymentListResponseSchema,
      VendorCustomerSuspend: vendorCustomerSuspendSchema,
      VendorCustomerResume: vendorCustomerResumeSchema,
    }).map(([name, schema]) => [name, toJsonSchema(schema)]),
  );
}

const sessionSecurity = [{ sessionCookie: [] }];
const vendorSessionSecurity = [{ vendorSessionCookie: [] }];
const anyAuthSecurity = [{ sessionCookie: [] }, { bearerAuth: [] }];

const dayQueryParameters = [
  { name: "from", in: "query", required: false, schema: { type: "string", format: "date" } },
  { name: "to", in: "query", required: false, schema: { type: "string", format: "date" } },
  {
    name: "membershipId",
    in: "query",
    required: false,
    schema: { type: "string", format: "uuid" },
  },
  {
    name: "limit",
    in: "query",
    required: false,
    schema: { type: "integer", minimum: 1, maximum: 500, default: 100 },
  },
];

export interface OpenApiOptions {
  readonly serverUrl: string;
  readonly version: string;
}

export function buildOpenApiDocument(options: OpenApiOptions): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: "Partner Coder API",
      version: options.version,
      description:
        "API кабинетов и агентов. Ошибки возвращаются в конверте { error: { code, message, requestId } }.",
    },
    servers: [{ url: options.serverUrl }],
    tags: [
      { name: "System", description: "Здоровье, готовность и метрики" },
      { name: "Auth", description: "Better Auth и выбор tenant" },
      { name: "Invitations", description: "Приглашения и членство" },
      { name: "Devices", description: "Device-токены агентов" },
      { name: "Tenant", description: "Данные рабочего пространства" },
      { name: "Vendor", description: "Вендорская консоль: доступ и пользователи" },
      { name: "Vendor finance", description: "Клиенты, тарифы и биллинг" },
    ],
    components: {
      schemas: componentSchemas(),
      securitySchemes: {
        sessionCookie: {
          type: "apiKey",
          in: "cookie",
          name: "better-auth.session_token",
          description: "Сессия Better Auth, выданная после OTP или magic link",
        },
        vendorSessionCookie: {
          type: "apiKey",
          in: "cookie",
          name: "pc-vendor.session_token",
          description: "Сессия Better Auth вендорской консоли (cookie pc-vendor.session_token)",
        },
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "pcd",
          description: "Device-токен вида pcd_...",
        },
      },
    },
    paths: {
      "/healthz": {
        get: {
          tags: ["System"],
          summary: "Проверка живости",
          responses: {
            200: { description: "Сервис жив", content: jsonContent(schemaRef("HealthResponse")) },
          },
        },
      },
      "/readyz": {
        get: {
          tags: ["System"],
          summary: "Готовность зависимостей",
          responses: {
            200: { description: "Сервис готов", content: jsonContent(schemaRef("ReadyResponse")) },
            503: errorResponse("Зависимость недоступна"),
          },
        },
      },
      "/metrics": {
        get: {
          tags: ["System"],
          summary: "Prometheus-метрики",
          responses: {
            200: { description: "Текстовый формат Prometheus", content: { "text/plain": {} } },
            401: errorResponse("Метрики закрыты токеном"),
          },
        },
      },
      "/openapi.json": {
        get: {
          tags: ["System"],
          summary: "Этот OpenAPI-документ",
          responses: { 200: { description: "OpenAPI 3.1", content: jsonContent({}) } },
        },
      },
      "/api/auth/{path}": {
        get: {
          tags: ["Auth"],
          summary: "Better Auth endpoint (проксируется как есть)",
          parameters: [{ name: "path", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            200: { description: "Ответ Better Auth" },
            429: errorResponse("Rate limit"),
          },
        },
        post: {
          tags: ["Auth"],
          summary: "Better Auth endpoint (проксируется как есть)",
          parameters: [{ name: "path", in: "path", required: true, schema: { type: "string" } }],
          requestBody: { required: false, content: jsonContent({ type: "object" }) },
          responses: {
            200: { description: "Ответ Better Auth" },
            400: errorResponse("Некорректный запрос"),
            401: errorResponse("Не аутентифицирован"),
            429: errorResponse("Rate limit"),
          },
        },
      },
      "/v1/auth/me": {
        get: {
          tags: ["Auth"],
          summary: "Текущий пользователь и членства",
          security: anyAuthSecurity,
          responses: {
            200: { description: "Профиль", content: jsonContent(schemaRef("AuthMeResponse")) },
            401: errorResponse("Не аутентифицирован"),
          },
        },
      },
      "/v1/auth/tenant": {
        post: {
          tags: ["Auth"],
          summary: "Выбрать активное рабочее пространство",
          security: sessionSecurity,
          requestBody: { required: true, content: jsonContent(schemaRef("TenantIdBody")) },
          responses: {
            200: {
              description: "Активный tenant обновлен",
              content: jsonContent(schemaRef("TenantSwitchResponse")),
            },
            403: errorResponse("Чужой tenant"),
          },
        },
      },
      "/v1/auth/invitations/{token}/accept": {
        post: {
          tags: ["Invitations"],
          summary: "Принять приглашение",
          security: sessionSecurity,
          parameters: [{ name: "token", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            200: {
              description: "Приглашение принято",
              content: jsonContent(schemaRef("AcceptInvitationResponse")),
            },
            409: errorResponse("Приглашение использовано или membership уже существует"),
          },
        },
      },
      "/v1/public/invitations/{token}": {
        get: {
          tags: ["Invitations"],
          summary: "Публичная информация о приглашении",
          parameters: [{ name: "token", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            200: {
              description: "Приглашение",
              content: jsonContent(schemaRef("PublicInvitationResponse")),
            },
            404: errorResponse("Не найдено"),
          },
        },
      },
      "/v1/tenant/invitations": {
        get: {
          tags: ["Invitations"],
          summary: "Список приглашений tenant",
          security: sessionSecurity,
          responses: {
            200: {
              description: "Приглашения",
              content: jsonContent(schemaRef("InvitationListResponse")),
            },
          },
        },
        post: {
          tags: ["Invitations"],
          summary: "Создать приглашение",
          security: sessionSecurity,
          requestBody: { required: true, content: jsonContent(schemaRef("InvitationCreate")) },
          responses: {
            201: {
              description: "Приглашение создано",
              content: jsonContent(schemaRef("InvitationCreateResponse")),
            },
            403: errorResponse("Недостаточно прав"),
          },
        },
      },
      "/v1/tenant/invitations/{id}": {
        delete: {
          tags: ["Invitations"],
          summary: "Отозвать приглашение",
          security: sessionSecurity,
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          ],
          responses: {
            204: { description: "Отозвано" },
            404: errorResponse("Не найдено"),
          },
        },
      },
      "/v1/me/devices": {
        get: {
          tags: ["Devices"],
          summary: "Device-токены пользователя",
          security: sessionSecurity,
          responses: {
            200: {
              description: "Список устройств",
              content: jsonContent(schemaRef("DeviceListResponse")),
            },
          },
        },
        post: {
          tags: ["Devices"],
          summary: "Выпустить device-токен",
          security: sessionSecurity,
          requestBody: { required: false, content: jsonContent(schemaRef("DeviceCreate")) },
          responses: {
            201: {
              description: "Токен выпущен",
              content: jsonContent(schemaRef("DeviceIssuedResponse")),
            },
          },
        },
      },
      "/v1/me/devices/{id}/rotate": {
        post: {
          tags: ["Devices"],
          summary: "Ротировать device-токен",
          security: sessionSecurity,
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          ],
          responses: {
            200: {
              description: "Новый токен",
              content: jsonContent(schemaRef("DeviceIssuedResponse")),
            },
          },
        },
      },
      "/v1/me/devices/{id}": {
        delete: {
          tags: ["Devices"],
          summary: "Отозвать device-токен",
          security: anyAuthSecurity,
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          ],
          responses: { 204: { description: "Отозван" }, 404: errorResponse("Не найден") },
        },
      },
      "/v1/tenant/overview": {
        get: {
          tags: ["Tenant"],
          summary: "Сводка tenant",
          security: sessionSecurity,
          responses: {
            200: {
              description: "Сводка",
              content: jsonContent(schemaRef("TenantOverviewResponse")),
            },
          },
        },
      },
      "/v1/tenant/members": {
        get: {
          tags: ["Tenant"],
          summary: "Участники tenant",
          security: sessionSecurity,
          responses: {
            200: {
              description: "Участники",
              content: jsonContent(schemaRef("TenantMembersResponse")),
            },
          },
        },
      },
      "/v1/tenant/projects": {
        get: {
          tags: ["Tenant"],
          summary: "Проекты tenant",
          security: sessionSecurity,
          responses: {
            200: {
              description: "Проекты",
              content: jsonContent(schemaRef("TenantProjectsResponse")),
            },
          },
        },
      },
      "/v1/tenant/days": {
        get: {
          tags: ["Tenant"],
          summary: "Закрытые дни tenant",
          security: sessionSecurity,
          parameters: dayQueryParameters,
          responses: {
            200: {
              description: "Дни",
              content: jsonContent(schemaRef("TenantDaysResponse")),
            },
          },
        },
      },
      "/v1/vendor/auth/me": {
        get: {
          tags: ["Vendor"],
          summary: "Текущий вендор и состояние MFA",
          security: vendorSessionSecurity,
          responses: {
            200: {
              description: "Профиль вендора",
              content: jsonContent(schemaRef("VendorAuthMeResponse")),
            },
            401: errorResponse("Не аутентифицирован"),
            403: errorResponse("Учётная запись заблокирована"),
          },
        },
      },
      "/v1/vendor/auth/step-up": {
        post: {
          tags: ["Vendor"],
          summary: "Повторное подтверждение пароля",
          security: vendorSessionSecurity,
          requestBody: { required: true, content: jsonContent(schemaRef("VendorStepUpRequest")) },
          responses: {
            200: {
              description: "Step-up активен",
              content: jsonContent(schemaRef("VendorStepUpResponse")),
            },
            400: errorResponse("Неверный пароль"),
            401: errorResponse("Не аутентифицирован"),
            403: errorResponse("Требуется MFA"),
            429: errorResponse("Слишком много попыток"),
          },
        },
      },
      "/v1/vendor/users": {
        get: {
          tags: ["Vendor"],
          summary: "Список вендорских пользователей",
          security: vendorSessionSecurity,
          responses: {
            200: {
              description: "Пользователи",
              content: jsonContent(schemaRef("VendorUserListResponse")),
            },
            401: errorResponse("Не аутентифицирован"),
            403: errorResponse("Требуется MFA или роль superadmin"),
          },
        },
        post: {
          tags: ["Vendor"],
          summary: "Создать или пригласить вендорского пользователя",
          security: vendorSessionSecurity,
          requestBody: { required: true, content: jsonContent(schemaRef("VendorUserCreate")) },
          responses: {
            201: {
              description: "Пользователь создан",
              content: jsonContent(schemaRef("VendorUserResponse")),
            },
            200: {
              description: "Приглашение отправлено повторно",
              content: jsonContent(schemaRef("VendorUserResponse")),
            },
            400: errorResponse("Некорректный запрос или нет подтверждения superadmin"),
            401: errorResponse("Не аутентифицирован"),
            403: errorResponse("Требуется MFA или роль superadmin"),
            409: errorResponse("Пользователь уже существует или заблокирован"),
          },
        },
      },
      "/v1/vendor/users/{id}": {
        patch: {
          tags: ["Vendor"],
          summary: "Изменить роль или статус вендорского пользователя",
          security: vendorSessionSecurity,
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          ],
          requestBody: { required: true, content: jsonContent(schemaRef("VendorUserUpdate")) },
          responses: {
            200: {
              description: "Пользователь обновлён",
              content: jsonContent(schemaRef("VendorUserResponse")),
            },
            400: errorResponse("Некорректный запрос или нет подтверждения superadmin"),
            401: errorResponse("Не аутентифицирован"),
            403: errorResponse("Требуется MFA или роль superadmin"),
            404: errorResponse("Пользователь не найден"),
            409: errorResponse("Нельзя изменить себя"),
          },
        },
      },
      "/v1/vendor/users/{id}/reset-password": {
        post: {
          tags: ["Vendor"],
          summary: "Отправить ссылку сброса пароля",
          security: vendorSessionSecurity,
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          ],
          responses: {
            200: {
              description: "Ссылка отправлена",
              content: jsonContent(schemaRef("VendorPasswordResetResponse")),
            },
            401: errorResponse("Не аутентифицирован"),
            403: errorResponse("Требуется MFA или роль superadmin"),
            404: errorResponse("Пользователь не найден"),
            409: errorResponse("Учётная запись заблокирована"),
          },
        },
      },
      "/v1/vendor/users/{id}/reset-mfa": {
        post: {
          tags: ["Vendor"],
          summary: "Сбросить TOTP, passkeys и сессии пользователя",
          security: vendorSessionSecurity,
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          ],
          responses: {
            200: {
              description: "MFA сброшен",
              content: jsonContent(schemaRef("VendorMfaResetResponse")),
            },
            401: errorResponse("Не аутентифицирован"),
            403: errorResponse("Требуется MFA или роль superadmin"),
            404: errorResponse("Пользователь не найден"),
          },
        },
      },
      "/v1/vendor/customers": {
        get: {
          tags: ["Vendor finance"],
          summary: "Список клиентов",
          security: vendorSessionSecurity,
          parameters: [
            {
              name: "status",
              in: "query",
              required: false,
              schema: {
                type: "string",
                enum: ["lead", "trial", "active", "grace", "suspended", "expired", "churned"],
              },
            },
            { name: "query", in: "query", required: false, schema: { type: "string" } },
            {
              name: "limit",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 1, maximum: 500, default: 100 },
            },
          ],
          responses: {
            200: {
              description: "Клиенты",
              content: jsonContent(schemaRef("VendorCustomerListResponse")),
            },
            401: errorResponse("Не аутентифицирован"),
            403: errorResponse("Требуется MFA или роль"),
          },
        },
        post: {
          tags: ["Vendor finance"],
          summary: "Создать клиента",
          security: vendorSessionSecurity,
          requestBody: { required: true, content: jsonContent(schemaRef("VendorCustomerCreate")) },
          responses: {
            201: {
              description: "Клиент создан",
              content: jsonContent(schemaRef("VendorCustomerResponse")),
            },
            400: errorResponse("Некорректный запрос"),
            401: errorResponse("Не аутентифицирован"),
            403: errorResponse("Требуется MFA или роль superadmin"),
            409: errorResponse("Клиент с таким ИНН уже существует"),
          },
        },
      },
      "/v1/vendor/customers/{id}": {
        get: {
          tags: ["Vendor finance"],
          summary: "Карточка клиента",
          security: vendorSessionSecurity,
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          ],
          responses: {
            200: {
              description: "Клиент",
              content: jsonContent(schemaRef("VendorCustomerResponse")),
            },
            401: errorResponse("Не аутентифицирован"),
            403: errorResponse("Требуется MFA или роль"),
            404: errorResponse("Клиент не найден"),
          },
        },
        patch: {
          tags: ["Vendor finance"],
          summary: "Изменить клиента",
          security: vendorSessionSecurity,
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          ],
          requestBody: { required: true, content: jsonContent(schemaRef("VendorCustomerUpdate")) },
          responses: {
            200: {
              description: "Клиент обновлён",
              content: jsonContent(schemaRef("VendorCustomerResponse")),
            },
            400: errorResponse("Некорректный запрос"),
            401: errorResponse("Не аутентифицирован"),
            403: errorResponse("Требуется MFA или роль superadmin"),
            404: errorResponse("Клиент не найден"),
            409: errorResponse("Клиент с таким ИНН уже существует"),
          },
        },
      },
      "/v1/vendor/plans": {
        get: {
          tags: ["Vendor finance"],
          summary: "Список тарифов",
          security: vendorSessionSecurity,
          parameters: [
            { name: "activeOnly", in: "query", required: false, schema: { type: "boolean" } },
            { name: "query", in: "query", required: false, schema: { type: "string" } },
            {
              name: "limit",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 1, maximum: 500, default: 100 },
            },
          ],
          responses: {
            200: {
              description: "Тарифы",
              content: jsonContent(schemaRef("VendorPlanListResponse")),
            },
            401: errorResponse("Не аутентифицирован"),
            403: errorResponse("Требуется MFA или роль"),
          },
        },
        post: {
          tags: ["Vendor finance"],
          summary: "Создать тариф",
          security: vendorSessionSecurity,
          requestBody: { required: true, content: jsonContent(schemaRef("VendorPlanCreate")) },
          responses: {
            201: {
              description: "Тариф создан",
              content: jsonContent(schemaRef("VendorPlanResponse")),
            },
            400: errorResponse("Некорректный запрос"),
            401: errorResponse("Не аутентифицирован"),
            403: errorResponse("Требуется MFA или роль superadmin"),
            409: errorResponse("Тариф с таким кодом уже существует"),
          },
        },
      },
      "/v1/vendor/plans/{id}": {
        patch: {
          tags: ["Vendor finance"],
          summary: "Изменить тариф",
          security: vendorSessionSecurity,
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          ],
          requestBody: { required: true, content: jsonContent(schemaRef("VendorPlanUpdate")) },
          responses: {
            200: {
              description: "Тариф обновлён",
              content: jsonContent(schemaRef("VendorPlanResponse")),
            },
            400: errorResponse("Некорректный запрос"),
            401: errorResponse("Не аутентифицирован"),
            403: errorResponse("Требуется MFA или роль superadmin"),
            404: errorResponse("Тариф не найден"),
          },
        },
      },
      "/v1/vendor/contracts": {
        get: {
          tags: ["Vendor finance"],
          summary: "Список договоров",
          security: vendorSessionSecurity,
          parameters: [
            {
              name: "customerId",
              in: "query",
              required: false,
              schema: { type: "string", format: "uuid" },
            },
            {
              name: "status",
              in: "query",
              required: false,
              schema: { type: "string", enum: ["draft", "active", "ended", "terminated"] },
            },
            {
              name: "limit",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 1, maximum: 500, default: 100 },
            },
          ],
          responses: {
            200: {
              description: "Договоры",
              content: jsonContent(schemaRef("VendorContractListResponse")),
            },
            401: errorResponse("Не аутентифицирован"),
            403: errorResponse("Требуется MFA или роль"),
          },
        },
        post: {
          tags: ["Vendor finance"],
          summary: "Создать договор",
          security: vendorSessionSecurity,
          requestBody: { required: true, content: jsonContent(schemaRef("VendorContractCreate")) },
          responses: {
            201: {
              description: "Договор создан",
              content: jsonContent(schemaRef("VendorContractResponse")),
            },
            400: errorResponse("Некорректный запрос"),
            401: errorResponse("Не аутентифицирован"),
            403: errorResponse("Требуется MFA или роль superadmin"),
            404: errorResponse("Клиент или тариф не найден"),
            409: errorResponse("Договор с таким номером уже существует"),
          },
        },
      },
      "/v1/vendor/subscriptions": {
        get: {
          tags: ["Vendor finance"],
          summary: "Список подписок",
          security: vendorSessionSecurity,
          parameters: [
            {
              name: "customerId",
              in: "query",
              required: false,
              schema: { type: "string", format: "uuid" },
            },
            {
              name: "status",
              in: "query",
              required: false,
              schema: {
                type: "string",
                enum: ["trial", "active", "grace", "expired", "suspended", "cancelled"],
              },
            },
            {
              name: "limit",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 1, maximum: 500, default: 100 },
            },
          ],
          responses: {
            200: {
              description: "Подписки",
              content: jsonContent(schemaRef("VendorSubscriptionListResponse")),
            },
            401: errorResponse("Не аутентифицирован"),
            403: errorResponse("Требуется MFA или роль"),
          },
        },
        post: {
          tags: ["Vendor finance"],
          summary: "Создать подписку",
          security: vendorSessionSecurity,
          requestBody: {
            required: true,
            content: jsonContent(schemaRef("VendorSubscriptionCreate")),
          },
          responses: {
            201: {
              description: "Подписка создана",
              content: jsonContent(schemaRef("VendorSubscriptionResponse")),
            },
            400: errorResponse("Некорректный запрос"),
            401: errorResponse("Не аутентифицирован"),
            403: errorResponse("Требуется MFA или роль superadmin"),
            404: errorResponse("Клиент, договор или тариф не найден"),
          },
        },
      },
      "/v1/vendor/subscriptions/{id}/renew": {
        post: {
          tags: ["Vendor finance"],
          summary: "Продлить подписку",
          description: "Требует step-up. Частичные оплаты и переплаты не сверяются автоматически.",
          security: vendorSessionSecurity,
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          ],
          requestBody: {
            required: true,
            content: jsonContent(schemaRef("VendorSubscriptionRenew")),
          },
          responses: {
            200: {
              description: "Подписка продлена",
              content: jsonContent(schemaRef("VendorSubscriptionResponse")),
            },
            400: errorResponse("Некорректный запрос"),
            401: errorResponse("Не аутентифицирован"),
            403: errorResponse("Требуется MFA, step-up или роль finance"),
            404: errorResponse("Подписка не найдена"),
            409: errorResponse("Подписка приостановлена или отменена"),
          },
        },
      },
      "/v1/vendor/subscriptions/{id}/status": {
        post: {
          tags: ["Vendor finance"],
          summary: "Изменить статус подписки",
          description: "Требует step-up. Приостановка выполняется через карточку клиента.",
          security: vendorSessionSecurity,
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          ],
          requestBody: {
            required: true,
            content: jsonContent(schemaRef("VendorSubscriptionStatusUpdate")),
          },
          responses: {
            200: {
              description: "Статус изменён",
              content: jsonContent(schemaRef("VendorSubscriptionResponse")),
            },
            400: errorResponse("Некорректный запрос"),
            401: errorResponse("Не аутентифицирован"),
            403: errorResponse("Требуется MFA, step-up или роль finance"),
            404: errorResponse("Подписка не найдена"),
            409: errorResponse("Переход статуса запрещён"),
          },
        },
      },
      "/v1/vendor/subscriptions/{id}/discounts": {
        get: {
          tags: ["Vendor finance"],
          summary: "Скидки подписки",
          security: vendorSessionSecurity,
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          ],
          responses: {
            200: {
              description: "Скидки",
              content: jsonContent(schemaRef("VendorDiscountListResponse")),
            },
            401: errorResponse("Не аутентифицирован"),
            403: errorResponse("Требуется MFA или роль"),
            404: errorResponse("Подписка не найдена"),
          },
        },
        post: {
          tags: ["Vendor finance"],
          summary: "Назначить скидку",
          description: "Требует step-up и роль superadmin.",
          security: vendorSessionSecurity,
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          ],
          requestBody: {
            required: true,
            content: jsonContent(schemaRef("VendorDiscountCreate")),
          },
          responses: {
            201: {
              description: "Скидка назначена",
              content: jsonContent(schemaRef("VendorDiscountResponse")),
            },
            400: errorResponse("Некорректный запрос"),
            401: errorResponse("Не аутентифицирован"),
            403: errorResponse("Требуется MFA, step-up или роль superadmin"),
            404: errorResponse("Подписка не найдена"),
            409: errorResponse("Скидка на этот период уже назначена"),
          },
        },
      },
      "/v1/vendor/invoices": {
        get: {
          tags: ["Vendor finance"],
          summary: "Список счетов",
          security: vendorSessionSecurity,
          parameters: [
            {
              name: "customerId",
              in: "query",
              required: false,
              schema: { type: "string", format: "uuid" },
            },
            {
              name: "status",
              in: "query",
              required: false,
              schema: {
                type: "string",
                enum: ["draft", "issued", "paid", "partial", "overdue", "void"],
              },
            },
            {
              name: "limit",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 1, maximum: 500, default: 100 },
            },
          ],
          responses: {
            200: {
              description: "Счета",
              content: jsonContent(schemaRef("VendorInvoiceListResponse")),
            },
            401: errorResponse("Не аутентифицирован"),
            403: errorResponse("Требуется MFA или роль"),
          },
        },
        post: {
          tags: ["Vendor finance"],
          summary: "Создать счёт",
          description: "Требует step-up и роль finance.",
          security: vendorSessionSecurity,
          requestBody: { required: true, content: jsonContent(schemaRef("VendorInvoiceCreate")) },
          responses: {
            201: {
              description: "Счёт создан",
              content: jsonContent(schemaRef("VendorInvoiceResponse")),
            },
            400: errorResponse("Некорректный запрос"),
            401: errorResponse("Не аутентифицирован"),
            403: errorResponse("Требуется MFA, step-up или роль finance"),
            404: errorResponse("Клиент или договор не найден"),
            409: errorResponse("Счёт с таким номером уже существует"),
          },
        },
      },
      "/v1/vendor/invoices/{id}": {
        patch: {
          tags: ["Vendor finance"],
          summary: "Изменить счёт",
          description: "Статус и ссылка на PDF. Требует step-up и роль finance.",
          security: vendorSessionSecurity,
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          ],
          requestBody: { required: true, content: jsonContent(schemaRef("VendorInvoiceUpdate")) },
          responses: {
            200: {
              description: "Счёт обновлён",
              content: jsonContent(schemaRef("VendorInvoiceResponse")),
            },
            400: errorResponse("Некорректный запрос"),
            401: errorResponse("Не аутентифицирован"),
            403: errorResponse("Требуется MFA, step-up или роль finance"),
            404: errorResponse("Счёт не найден"),
          },
        },
      },
      "/v1/vendor/payments": {
        get: {
          tags: ["Vendor finance"],
          summary: "Список платежей",
          security: vendorSessionSecurity,
          parameters: [
            {
              name: "invoiceId",
              in: "query",
              required: false,
              schema: { type: "string", format: "uuid" },
            },
            {
              name: "customerId",
              in: "query",
              required: false,
              schema: { type: "string", format: "uuid" },
            },
            {
              name: "limit",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 1, maximum: 500, default: 100 },
            },
          ],
          responses: {
            200: {
              description: "Платежи",
              content: jsonContent(schemaRef("VendorPaymentListResponse")),
            },
            401: errorResponse("Не аутентифицирован"),
            403: errorResponse("Требуется MFA или роль"),
          },
        },
        post: {
          tags: ["Vendor finance"],
          summary: "Внести платёж",
          description: "Требует step-up и роль finance. Статус счёта не сверяется автоматически.",
          security: vendorSessionSecurity,
          requestBody: { required: true, content: jsonContent(schemaRef("VendorPaymentCreate")) },
          responses: {
            201: {
              description: "Платёж внесён",
              content: jsonContent(schemaRef("VendorPaymentResponse")),
            },
            400: errorResponse("Некорректный запрос"),
            401: errorResponse("Не аутентифицирован"),
            403: errorResponse("Требуется MFA, step-up или роль finance"),
            404: errorResponse("Счёт или клиент не найден"),
            409: errorResponse("Счёт нельзя оплатить"),
          },
        },
      },
      "/v1/vendor/customers/{id}/suspend": {
        post: {
          tags: ["Vendor finance"],
          summary: "Приостановить клиента",
          description: "Требует step-up и роль superadmin.",
          security: vendorSessionSecurity,
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          ],
          requestBody: {
            required: false,
            content: jsonContent(schemaRef("VendorCustomerSuspend")),
          },
          responses: {
            200: {
              description: "Клиент приостановлен",
              content: jsonContent(schemaRef("VendorCustomerResponse")),
            },
            400: errorResponse("Некорректный запрос"),
            401: errorResponse("Не аутентифицирован"),
            403: errorResponse("Требуется MFA, step-up или роль superadmin"),
            404: errorResponse("Клиент не найден"),
          },
        },
      },
      "/v1/vendor/customers/{id}/resume": {
        post: {
          tags: ["Vendor finance"],
          summary: "Возобновить клиента",
          description: "Требует step-up и роль superadmin.",
          security: vendorSessionSecurity,
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          ],
          requestBody: {
            required: false,
            content: jsonContent(schemaRef("VendorCustomerResume")),
          },
          responses: {
            200: {
              description: "Клиент возобновлён",
              content: jsonContent(schemaRef("VendorCustomerResponse")),
            },
            400: errorResponse("Некорректный запрос"),
            401: errorResponse("Не аутентифицирован"),
            403: errorResponse("Требуется MFA, step-up или роль superadmin"),
            404: errorResponse("Клиент не найден"),
          },
        },
      },
    },
  };
}
