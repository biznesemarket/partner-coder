# Матрица авторизации

| Поле      | Значение                                                        |
| --------- | --------------------------------------------------------------- |
| Код       | SEC-AUTHZ                                                       |
| Версия    | 1.1                                                             |
| Статус    | tenant — M2.2; вендорский контур — M3 PR A                      |
| Связанные | ADR-0006, ADR-0010, ADR-0013, `packages/contracts/src/authz.ts` |

Матрица — единственный источник прав в коде. API, worker и тесты используют
`can()` и `authorize()` из `@partner-coder/contracts`; дублировать правила в
маршрутах нельзя.

## 1. Правила

1. Чужой tenant запрещен всегда, даже если роль имеет право на действие дома.
2. Без активного tenant действие, которому нужен tenant-контекст, запрещено.
3. Неизвестная роль не получает прав.
4. Отказ пишется в `tenant_audit_events` (`authz.denied`) с ролью, причиной и
   `requestId`.
5. Tenant берется только из сессии или device-токена; тело запроса не задает
   tenant.

## 2. Роли

| Роль      | Назначение                                              |
| --------- | ------------------------------------------------------- |
| director  | администратор клиента: команда, проекты, политика       |
| developer | участник: свои дни, споры, устройства, агентские сессии |
| finance   | финансы клиента: выплаты, отчеты, аудит                 |
| support   | поддержка клиента: чтение, споры, приглашения           |

## 3. Матрица

Действия: `read`, `create`, `update`, `delete`, `approve`, `export`.

| Ресурс            | director                      | developer                    | finance                       | support              |
| ----------------- | ----------------------------- | ---------------------------- | ----------------------------- | -------------------- |
| tenant            | read, update                  | read                         | read                          | read                 |
| membership        | read, create, update, delete  | read                         | read                          | read                 |
| invitation        | read, create, delete          | —                            | read                          | read, create, delete |
| project           | read, create, update, delete  | read                         | read                          | read                 |
| policy            | read, create, update, approve | read                         | read                          | read                 |
| rate_version      | read, create, approve         | read                         | read                          | read                 |
| valuation_version | read, create, approve         | read                         | read                          | read                 |
| day_record        | read, export                  | read, export                 | read, export                  | read                 |
| day_adjustment    | read, create, approve         | read                         | read                          | read                 |
| day_flag          | read, update                  | read                         | read                          | read                 |
| dispute           | read, update, approve         | read, create                 | read                          | read, update         |
| payout            | read, create, approve, export | read                         | read, create, approve, export | read                 |
| report            | read, export                  | read                         | read, export                  | read                 |
| integration       | read, create, update, delete  | read                         | read                          | read                 |
| audit             | read, export                  | —                            | read, export                  | read                 |
| notification      | read                          | read                         | read                          | read                 |
| device            | read, create, update, delete  | read, create, update, delete | read                          | read                 |
| agent_session     | read                          | read, create, update         | —                             | read                 |
| profile           | read, update                  | read, update                 | read, update                  | read, update         |

Ограничения владения (например, разработчик управляет только своими
устройствами и видит только свои дни) проверяются сервисами и RLS поверх
матрицы. Support может выдать приглашением только `developer`; `director` —
любую роль; `developer`/`finance` не выдают роли.

Device-токен не является заменой веб-сессии: он не получает tenant-маршруты и
матричные действия, кроме `device:delete` для собственного токена. Выпуск и
ротация device-токена доступны только веб-сессии. Приостановленный или
архивный tenant не дает активного tenant-контекста.

## 4. Проверки

- `packages/contracts/src/authz.test.ts` перебирает все комбинации
  «роль × ресурс × действие» и все комбинации с чужим tenant.
- `packages/db/test/rls.test.ts` проверяет изоляцию чтения/записи/вставки.
- `apps/api/src/auth/e2e.test.ts` проходит вход, приглашение, device token и
  отзыв через HTTP API.
- `apps/api/src/vendor-auth/e2e.test.ts` проходит bootstrap суперадмина,
  пароль, TOTP, роли, блокировку, сброс MFA и проверку аудита через реальный
  Fastify и Better Auth.

## 5. Вендорский контур

Вендорские роли не входят в tenant-матрицу: у них нет членств, tenant-контекста
и device-токенов. Доступ к `/v1/vendor/*` строится цепочкой guard-ов:

1. `authenticateVendor` — валидная сессия Better Auth; иначе 401
   `vendor_unauthenticated`;
2. статус `invited`/`active` допускается, `suspended`/`disabled` — 403
   `vendor_inactive`, сессия отзывается;
3. `requireVendorMfa` — `twoFactorEnabled === true`, иначе 403
   `vendor_mfa_required`;
4. `requireVendorRole([...])` — роль из `vendor_users`; иначе 403
   `vendor_role_denied` и событие `vendor.auth.role_denied`;
5. `requireVendorStepUp` — `stepUpUntil > now()`, иначе 403
   `vendor_step_up_required`.

| Маршрут                                    | superadmin | finance | support | readonly |
| ------------------------------------------ | ---------- | ------- | ------- | -------- |
| `GET /v1/vendor/auth/me`                   | да         | да      | да      | да       |
| `POST /v1/vendor/auth/step-up`             | да         | да      | да      | да       |
| `GET/POST /v1/vendor/users`                | да         | —       | —       | —        |
| `PATCH /v1/vendor/users/:id`               | да         | —       | —       | —        |
| `POST /v1/vendor/users/:id/reset-password` | да         | —       | —       | —        |
| `POST /v1/vendor/users/:id/reset-mfa`      | да         | —       | —       | —        |

`GET /v1/vendor/auth/me` и шаги включения TOTP доступны без MFA, чтобы
пользователь мог завершить настройку; остальные `/v1/vendor/*` требуют TOTP.
`finance`/`support`/`readonly` получают профильные действия в следующих
этапах M3; в PR A их доступ ограничен профилем и step-up. Назначение роли
`superadmin` требует `confirmSuperadmin: true`; изменить собственную запись
нельзя (409 `vendor_self_change_denied`). Прямой доступ к прокси
`/api/vendor-auth/*` после входа не даёт вендорских данных вне guard-ов.
