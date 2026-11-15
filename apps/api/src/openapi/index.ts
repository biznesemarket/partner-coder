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
    }).map(([name, schema]) => [name, toJsonSchema(schema)]),
  );
}

const sessionSecurity = [{ sessionCookie: [] }];
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
    },
  };
}
