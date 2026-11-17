# API: правила и группы маршрутов

| Поле   | Значение                        |
| ------ | ------------------------------- |
| Код    | ARCH-API                        |
| Версия | 1.3                             |
| Статус | реализация M2.3, M3 PR A и PR B |

## 1. Базовые правила

- Версия в пути: `/v1`. OpenAPI 3.1 генерируется из Zod-схем.
- Все ответы и запросы — JSON; деньги и доли передаются **строками**
  (копейки, базисные пункты, единицы доли) — `bigint` в JSON недопустим.
- Конверт ошибки:

```json
{
  "error": {
    "code": "cross_tenant_denied",
    "message": "Доступ к другому пространству запрещен",
    "details": {},
    "requestId": "01J..."
  }
}
```

- `requestId` возвращается в заголовке `x-request-id` и в теле ошибки.
- Идемпотентность: `Idempotency-Key` для мутаций, `event_id` для heartbeat,
  `delivery_id` для вебхуков.
- Пагинация курсорная (`cursor`, `limit`), лимиты и квоты на tenant/IP/device.
- Аутентификация: Better Auth (email OTP, magic link), cookie-сессии для web,
  Bearer `pcd_…` для агента, подпись Ed25519 для heartbeat, HMAC для вебхуков.
- CSRF, secure cookies, CSP, HSTS, rate limiting, ограничение размера тела
  (256 КБ), строгие security-заголовки.

## 2. Группы

| Группа               | Назначение                                                                 |
| -------------------- | -------------------------------------------------------------------------- |
| `/v1/auth/*`         | вход, magic link, OTP, passkeys, 2FA, выход, сессии                        |
| `/api/vendor-auth/*` | Better Auth вендорской консоли: password, reset, TOTP, passkeys            |
| `/v1/vendor/auth/*`  | профиль вендора, MFA-состояние и step-up                                   |
| `/v1/vendor/*`       | вендорские пользователи; клиенты, счета и аудит — следующие этапы M3       |
| `/v1/tenant/*`       | проекты, команда, политика, начисления, споры, выплаты, отчеты, интеграции |
| `/v1/me/*`           | профиль, дайджест, устройства, споры разработчика                          |
| `/v1/agent/*`        | enrollment, сессии, heartbeat, диагностика                                 |
| `/v1/onboarding/*`   | состояние, ответы, проверка git, приглашения, завершение                   |
| `/v1/hooks/*`        | GitHub, GitLab, Gitea/Forgejo                                              |
| `/v1/public/*`       | health, plans, legal, status                                               |

### 2.1 Реализовано в M2.2–M2.3

| Маршрут                                   | Назначение                                              |
| ----------------------------------------- | ------------------------------------------------------- |
| `/api/auth/*`                             | Better Auth: OTP, magic link, сессии, выход             |
| `GET /v1/auth/me`                         | профиль, членства, активный tenant                      |
| `POST /v1/auth/tenant`                    | выбор активного tenant из своих членств                 |
| `GET/POST /v1/tenant/invitations`         | список и создание приглашений                           |
| `DELETE /v1/tenant/invitations/:id`       | отзыв приглашения                                       |
| `GET /v1/public/invitations/:token`       | публичная информация о приглашении (email замаскирован) |
| `POST /v1/auth/invitations/:token/accept` | принятие приглашения аутентифицированным пользователем  |
| `GET/POST /v1/me/devices`                 | список и выпуск device-токенов                          |
| `POST /v1/me/devices/:id/rotate`          | ротация device-токена                                   |
| `DELETE /v1/me/devices/:id`               | отзыв device-токена                                     |
| `GET /v1/tenant/overview`                 | tenant, участники, проекты, закрытые дни                |
| `GET /v1/tenant/members`                  | команда tenant (RLS + users)                            |
| `GET /v1/tenant/projects`                 | проекты tenant (seed и продуктовая витрина)             |
| `GET /v1/tenant/days`                     | закрытые дни с фильтрами `from/to/membershipId/limit`   |
| `GET /metrics`                            | Prometheus-метрики (опционально `METRICS_TOKEN`)        |
| `GET /openapi.json`                       | OpenAPI 3.1 из Zod-схем                                 |

Все `/v1/tenant/*` и `/v1/me/*` проходят middleware аутентификации и матрицу
прав; отказ пишется в аудит. Публичный маршрут приглашения не раскрывает
полный email и не показывает хеш токена. Device-токен не заменяет веб-сессию:
tenant-маршруты ему закрыты, выпуск/ротация доступны только сессии.

### 2.2 Вендорский контур (M3 PR A)

Вход вендора — отдельный Better Auth на `/api/vendor-auth`: email + password,
одноразовая ссылка установки пароля, обязательный TOTP и (с PR B) passkeys.
Открытая регистрация (`/sign-up/*`) и отключение TOTP
(`/two-factor/disable`) через прокси запрещены. Passkeys реализованы в PR B;
UI-страницы живут в `apps/web` и ходят в API через same-origin BFF (§2.3).
Tenant-auth не менялся.

| Маршрут                                    | Доступ                           | Назначение                                          |
| ------------------------------------------ | -------------------------------- | --------------------------------------------------- |
| `GET/POST /api/vendor-auth/*`              | публично/сессия по endpoint      | прокси Better Auth: password, reset, TOTP, passkeys |
| `GET /v1/vendor/auth/me`                   | валидная сессия, в т.ч. без TOTP | пользователь, статус MFA, `stepUpUntil`             |
| `POST /v1/vendor/auth/step-up`             | сессия + TOTP                    | повторный пароль, окно 5 минут                      |
| `GET /v1/vendor/users`                     | superadmin + TOTP                | список вендорских пользователей                     |
| `POST /v1/vendor/users`                    | superadmin + TOTP                | создание/повторное приглашение                      |
| `PATCH /v1/vendor/users/:id`               | superadmin + TOTP                | роль/статус, отзыв сессий при блокировке            |
| `POST /v1/vendor/users/:id/reset-password` | superadmin + TOTP                | ссылка установки пароля                             |
| `POST /v1/vendor/users/:id/reset-mfa`      | superadmin + TOTP                | удаление TOTP/passkeys и сессий                     |

`requireVendorStepUp` и поле сессии `step_up_until` реализованы, а
`POST /v1/vendor/auth/step-up` обновляет окно. При этом ни один маршрут PR A
не требует step-up: обязательная проверка появится у первого опасного
действия M3.1 (счета, платежи, смена финансового статуса).

Прокси пропускает только нужные Better Auth endpoints. На `/sign-in/email` и
`/request-password-reset` действует per-email лимит 5/60 секунд (memory
локально, `vendor_auth_email_limits` вне local). Запрещены `/sign-up*`,
`/two-factor/disable`, `/two-factor/send-otp`, `/two-factor/verify-otp`,
`/admin/*`, `/delete-user`, `/change-email`, `/link-social`,
`/unlink-account`, `/sign-in/social`, `/callback/*`.

Для небезопасных методов с заголовком `Origin` проверяется, что источник —
`VENDOR_BASE_URL` или `API_BASE_URL`; иначе 403 `vendor_origin_denied`.
Отсутствие `Origin` допускается для server-to-server и тестов.

Собственные ошибки идут в `ErrorEnvelope`:

| Код                                | HTTP | Ситуация                                              |
| ---------------------------------- | ---- | ----------------------------------------------------- |
| `vendor_unauthenticated`           | 401  | нет сессии                                            |
| `vendor_inactive`                  | 403  | сессия suspended/disabled; сессия отзывается          |
| `vendor_mfa_required`              | 403  | TOTP не включён                                       |
| `vendor_role_denied`               | 403  | роль не допущена; пишется в аудит                     |
| `vendor_step_up_required`          | 403  | `stepUpUntil` истёк (guard есть; в PR A не требуется) |
| `invalid_password`                 | 400  | неверный пароль на step-up                            |
| `superadmin_confirmation_required` | 400  | нет `confirmSuperadmin: true`                         |
| `vendor_user_exists`               | 409  | пользователь active или invited с другой ролью        |
| `vendor_user_inactive`             | 409  | пользователь suspended/disabled                       |
| `vendor_user_not_found`            | 404  | неизвестный id                                        |
| `vendor_self_change_denied`        | 409  | попытка изменить собственную запись                   |
| `email_rate_limited`               | 429  | превышен per-email лимит входа/сброса/step-up         |
| `vendor_origin_denied`             | 403  | чужой `Origin`                                        |
| `vendor_auth_path_forbidden`       | 403  | запрещённый путь прокси                               |

Прокси возвращает ошибки Better Auth в его формате; в частности,
`POST /api/vendor-auth/sign-in/email` для suspended/disabled отвечает
403 с `code: "VENDOR_INACTIVE"` (не `ErrorEnvelope`). OpenAPI описывает только
собственные `/v1/vendor/*` маршруты; прокси документируется здесь.

### 2.3 BFF вендорской веб-консоли (M3 PR B)

Браузер не вызывает API напрямую. Next.js route handlers в `apps/web`
образуют same-origin BFF (ADR-0014):

| Next path                    | Target                                | Methods                  |
| ---------------------------- | ------------------------------------- | ------------------------ |
| `/api/vendor-auth/[...path]` | `${API_BASE_URL}/api/vendor-auth/...` | GET, POST                |
| `/v1/vendor/[...path]`       | `${API_BASE_URL}/v1/vendor/...`       | GET, POST, PATCH, DELETE |

Правила прокси:

- `runtime = "nodejs"`, `dynamic = "force-dynamic"`,
  `fetchCache = "force-no-store"`.
- Сегменты пути валидируются по `^[A-Za-z0-9._~-]+$`, без `.` и `..`; иначе
  400 `invalid_path`.
- Query-строка пробрасывается как есть, максимум 8 KiB; иначе 414
  `query_too_long`. Тело — `arrayBuffer`, максимум 64 KiB; иначе 413
  `payload_too_large`.
- В API-forward уходят только `cookie`, `content-type`, `accept`, `origin`,
  `user-agent`, `x-request-id`, `idempotency-key`; `host`, `content-length`,
  `connection`, `referer`, `x-forwarded-*` не уходят.
- `x-request-id` генерируется BFF, если его нет, и возвращается браузеру.
  Небезопасные методы при наличии `Origin` проверяют его на собственный
  origin BFF; несовпадение — 403 `origin_forbidden`. Отсутствие `Origin`
  допускается.
- Ответ копирует `content-type`, `content-disposition`, `x-request-id` и
  **все** `Set-Cookie` через `headers.getSetCookie()`; `content-encoding` и
  `content-length` не копируются, для всех ответов ставится
  `cache-control: no-store`.
- `redirect: "manual"`, таймаут 15 секунд. Сеть/таймаут — 502
  `upstream_unavailable`; тело ошибки не содержит upstream-деталей.

Passkey-специфика прокси:

- Challenge-cookie `pc-vendor-passkey` и все cookie Better Auth проходят через
  `Set-Cookie` без переписывания атрибутов; cookie остаются first-party на
  origin консоли.
- Управление passkeys (`generate-register-options`, `verify-registration`,
  `list-user-passkeys`, `delete-passkey`, `update-passkey`) и
  `change-password`/`revoke-session(s)` до включения TOTP отвечают 403
  `vendor_mfa_required`; для `suspended`/`disabled` — 403 `vendor_inactive`.
- Passkey-вход (`generate-authenticate-options`, `verify-authentication`) и
  `sign-out` не гейтятся, иначе вход или выход сломались бы.
- BFF не добавляет прав и не заменяет API-guard; авторизация остаётся в
  Fastify.

BFF не попадает в OpenAPI и не является отдельным публичным API: это
транспортный слой консоли. Ошибки BFF (`invalid_path`, `invalid_body`,
`origin_forbidden`, `payload_too_large`, `query_too_long`,
`upstream_unavailable`) — его
собственный конверт, а не `ErrorEnvelope` API.

## 3. Наблюдаемость и контракт

- Каждый запрос получает `x-request-id`; pino-логи редактируют
  `authorization`, cookie, query-токены и токен приглашения в пути. BFF
  сохраняет/генерирует `x-request-id`, не логирует body/cookie/query и
  возвращает `cache-control: no-store`.
- `/metrics` отдает `partner_coder_http_requests_total` и гистограмму
  длительности; в prod закрывается `METRICS_TOKEN` или сетевым allowlist.
- `/openapi.json` собирается из Zod-схем; типы клиента генерируются командой
  `pnpm --filter @partner-coder/api openapi:types`.
- Rate limit: global 300/min на инстанс, создание приглашения 20/min,
  OTP/magic-link — per-email 5/min, Better Auth — собственный лимит.
  Вне local оба лимита хранятся в PostgreSQL (`auth_rate_limits`,
  `email_rate_limits`) и общие для всех API-инстансов; local использует
  memory. Выбор переопределяется `RATE_LIMIT_STORAGE` (ADR-0012).
- Вендорский контур использует собственные `vendor_auth_rate_limits` и
  `vendor_auth_email_limits` (те же 5/60 на email для входа и сброса,
  5/5 минут на step-up); worker удаляет просроченные окна.
- Действия вендора пишутся в `vendor_audit_events` с хеш-цепочкой
  (`vendor_audit()`): приглашения, роли/статусы, reset/MFA, step-up,
  `sign_in_succeeded`/`sign_in_failed` (sha256 email), `mfa_failed`,
  `signed_out`, `password_changed`, `session_revoked`, а также
  `vendor.passkey.added`/`removed`/`renamed`. Passkey-вход отдельного события
  не создаёт: его покрывает `sign_in_succeeded`. `GET /openapi.json` содержит
  только собственные `/v1/vendor/*` маршруты.
- Security-заголовки: CSP `default-src 'none'`, `frame-ancestors 'none'`,
  HSTS вне local, `x-content-type-options`, `referrer-policy`.

## 4. Идемпотентность и ошибки

| Ситуация                              | Поведение                                     |
| ------------------------------------- | --------------------------------------------- |
| Повтор heartbeat `event_id`           | `duplicate`, без записи                       |
| Повтор `seq`                          | 409 `duplicate_seq`, инцидент в аудите        |
| Повтор закрытия дня с теми же данными | `duplicate`, тот же `input_hash`              |
| Изменившиеся данные после закрытия    | компенсация (`day_adjustment`)                |
| Повтор вебхука                        | `duplicate` по `delivery_id`                  |
| Повтор создания счета                 | `Idempotency-Key` возвращает тот же результат |
| Пакет просрочен                       | 410 `package_expired`, инструкция             |
| Пакет использован                     | 409 `package_used`, перевыпуск                |
| Кросс-тенантный запрос                | 403 `cross_tenant_denied`, аудит              |

## 5. Границы

- Tenant определяется только из сессии/токена, никогда из тела запроса.
- Вендорские маршруты не возвращают сырые heartbeat и данные активности.
- MCP-сервер вызывает тот же API; отдельного «внутреннего» канала нет.
