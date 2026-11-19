# Матрица авторизации

| Поле      | Значение                                                                  |
| --------- | ------------------------------------------------------------------------- |
| Код       | SEC-AUTHZ                                                                 |
| Версия    | 1.2                                                                       |
| Статус    | tenant — M2.2; вендорский контур — M3 PR A и PR B                         |
| Связанные | ADR-0006, ADR-0010, ADR-0013, ADR-0014, `packages/contracts/src/authz.ts` |

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
   `vendor_step_up_required`; guard и `step_up_until` реализованы, но в PR A
   ни один маршрут его не требует.

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
этапах M3; в PR B их доступ ограничен профилем и self-service безопасности,
а самостоятельный step-up доступен, но не обязателен. `requireVendorStepUp` и
`vendor_step_up_required` не подключены ни к одному маршруту PR A/B:
обязательная проверка появится у первого опасного действия M3.1 (счета,
платежи, смена финансового статуса).
Назначение роли `superadmin` требует `confirmSuperadmin: true`; изменить
собственную запись нельзя (409 `vendor_self_change_denied`). Прямой доступ к
прокси `/api/vendor-auth/*` после входа не даёт вендорских данных вне guard-ов.

### 5.1 Self-service вендорской консоли

Все вендорские роли (`superadmin`, `finance`, `support`, `readonly`) видят
только собственный профиль и собственные ключи доступа; чужих пользователей
через `/me` и `/me/security` не видно. Управление вендорскими пользователями
(`/v1/vendor/users`) остаётся API-only и доступно только `superadmin`.

| Действие в консоли                              | Условие                                        |
| ----------------------------------------------- | ---------------------------------------------- |
| `GET /v1/vendor/auth/me`                        | любая валидная сессия, в т.ч. без TOTP         |
| Включение TOTP                                  | сессия; экран `/setup-mfa`                     |
| Список/добавление/удаление passkey              | сессия + TOTP; иначе 403 `vendor_mfa_required` |
| `POST /change-password`                         | сессия + TOTP; иначе 403 `vendor_mfa_required` |
| `POST /revoke-session`, `revoke-other-sessions` | сессия + TOTP; иначе 403 `vendor_mfa_required` |
| `POST /sign-out`                                | сессия; доступен без TOTP                      |
| Passkey-вход                                    | публичный; не гейтится, иначе вход сломался    |

Password-only сессия (TOTP ещё не включён) не может менять пароль, отзывать
чужие сессии или управлять passkeys: украденный пароль не должен давать DoS
владельцу до сброса MFA. `suspended`/`disabled` получают 403
`vendor_inactive` даже при живой сессии; консоль ведёт на
`/login?reason=inactive`. Все успешные self-service действия пишутся в аудит
(`password_changed`, `session_revoked`, `vendor.passkey.added/removed`);
passkey-вход покрыт `sign_in_succeeded`.

### 5.2 M3.1: клиенты и финансы (план)

Матрица для первых опасных действий. Реализация появится в M3.1; до неё
маршруты не существуют. «Бухгалтер» в терминах системы — роль `finance`.

| Действие                         | superadmin                  | finance | support | readonly |
| -------------------------------- | --------------------------- | ------- | ------- | -------- |
| Клиенты: чтение                  | да                          | да      | да      | да       |
| Клиенты: создание/редактирование | да                          | —       | —       | —        |
| Тарифы: чтение                   | да                          | да      | да      | да       |
| Тарифы: изменение                | да                          | —       | —       | —        |
| Счёт: чтение                     | да                          | да      | да      | да       |
| Счёт: создание/отправка          | —                           | да      | —       | —        |
| Платёж: внесение                 | —                           | да      | —       | —        |
| Подписка: продление и статус     | —                           | да      | —       | —        |
| Скидка: назначение               | да                          | —       | —       | —        |
| Приостановка клиента             | да                          | —       | —       | —        |
| Возврат/списание                 | только после решения юриста | —       | —       | —        |
| Пакет: чтение                    | да                          | да      | да      | да       |
| Пакет: перевыпуск                | да                          | —       | да      | —        |
| Аудит: чтение                    | да                          | да      | да      | да       |

Step-up обязателен для: создания/отправки счёта, внесения платежа,
продления/смены статуса подписки, назначения скидки, приостановки,
возврата/списания. Read-only действия step-up не требуют.

Ограничения:

- `finance` не меняет тариф и не назначает скидку; скидка приходит от
  `superadmin` и отображается в счёте.
- `superadmin` не создаёт счёт и не вносит платёж вручную: это делает
  бухгалтерия через `finance`.
- `support` не меняет деньги и статусы, но может перевыпустить пакет.
- Резервного `superadmin` нет. Это утверждённый риск; восстановление —
  break-glass через владельца БД по `docs/07-ops/break-glass.md`, пока не
  появится второй администратор.
