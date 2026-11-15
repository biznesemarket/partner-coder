# API: правила и группы маршрутов

| Поле   | Значение        |
| ------ | --------------- |
| Код    | ARCH-API        |
| Версия | 1.1             |
| Статус | реализация M2.3 |

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

| Группа             | Назначение                                                                 |
| ------------------ | -------------------------------------------------------------------------- |
| `/v1/auth/*`       | вход, magic link, OTP, passkeys, 2FA, выход, сессии                        |
| `/v1/vendor/*`     | клиенты, тарифы, договоры, счета, оплаты, подписки, пакеты, воронка, аудит |
| `/v1/tenant/*`     | проекты, команда, политика, начисления, споры, выплаты, отчеты, интеграции |
| `/v1/me/*`         | профиль, дайджест, устройства, споры разработчика                          |
| `/v1/agent/*`      | enrollment, сессии, heartbeat, диагностика                                 |
| `/v1/onboarding/*` | состояние, ответы, проверка git, приглашения, завершение                   |
| `/v1/hooks/*`      | GitHub, GitLab, Gitea/Forgejo                                              |
| `/v1/public/*`     | health, plans, legal, status                                               |

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

## 3. Наблюдаемость и контракт

- Каждый запрос получает `x-request-id`; pino-логи редактируют
  `authorization`, cookie, query-токены и токен приглашения в пути.
- `/metrics` отдает `partner_coder_http_requests_total` и гистограмму
  длительности; в prod закрывается `METRICS_TOKEN` или сетевым allowlist.
- `/openapi.json` собирается из Zod-схем; типы клиента генерируются командой
  `pnpm --filter @partner-coder/api openapi:types`.
- Rate limit: global 300/min на инстанс, создание приглашения 20/min,
  OTP/magic-link — per-email 5/min, Better Auth — собственный лимит.
  Вне local оба лимита хранятся в PostgreSQL (`auth_rate_limits`,
  `email_rate_limits`) и общие для всех API-инстансов; local использует
  memory. Выбор переопределяется `RATE_LIMIT_STORAGE` (ADR-0012).
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
