# Матрица авторизации tenant-контура

| Поле      | Значение                                              |
| --------- | ----------------------------------------------------- |
| Код       | SEC-AUTHZ                                             |
| Версия    | 1.0                                                   |
| Статус    | реализовано в M2.2                                    |
| Связанные | ADR-0006, ADR-0010, `packages/contracts/src/authz.ts` |

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
