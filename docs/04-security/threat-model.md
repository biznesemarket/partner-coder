# Модель угроз (сводка)

| Поле      | Значение                                         |
| --------- | ------------------------------------------------ |
| Код       | SEC-THREATS                                      |
| Версия    | 1.2                                              |
| Связанные | ADR-0002, ADR-0006, ADR-0007, ADR-0013, ADR-0014 |

## 1. Активы

1. Деньги: начисления, корректировки, выплаты, счета вендора.
2. Доверие: воспроизводимость расчета и объяснимость каждой цифры.
3. Данные активности: интервалы, классы, устройства (без кода и промптов).
4. Доступы: сессии директора, токены устройств, одноразовые ключи пакетов.
5. Доступность: закрытие дня, дайджесты, кабинеты.

## 2. Угрозы и меры

| Угроза                         | Мера                                                                                                |
| ------------------------------ | --------------------------------------------------------------------------------------------------- |
| Накрутка времени               | классы, капы, подписанные события, IDE-сигналы, флаги, споры                                        |
| Ночной автономный прогон       | флаг `night_autonomous_spike`, кап автономного, коэффициент                                         |
| Синтетический ввод             | эвристика одинаковых интервалов, флаг, решение директора                                            |
| Replay/подмена событий         | `event_id`, `seq`, подпись Ed25519, серверное время                                                 |
| Кража zip/ключа                | одноразовый TTL-токен, email-верификация, отзыв, аудит                                              |
| Подбор OTP / перехват письма   | 6 цифр, TTL 10 минут, лимит попыток, общий rate limit в PostgreSQL, HMAC-SHA-256 с AUTH_SECRET      |
| Кража magic-link               | одноразовый TTL-токен, в БД только хеш, привязка к email                                            |
| Кража cookie-сессии            | HttpOnly/SameSite, HTTPS, TTL сессии, отзыв, аудит                                                  |
| Кража приглашения              | SHA-256 в БД, TTL, одна активация, совпадение email, отзыв                                          |
| Кража устройства               | device key, отзыв, ротация, ограниченный scope, хеш токена                                          |
| Обход ролей                    | матрица authz, tenant из сессии/токена, отказы в аудите                                             |
| Кросс-тенантная утечка         | RLS + `SET LOCAL app.tenant_id` + authz-матрица + пентest                                           |
| Подделка вебхука               | HMAC сырого тела, сравнение постоянным временем, dedupe                                             |
| Взлом суперадмина              | TOTP обязателен, короткая сессия, аудит, IP allowlist (позже); passkey — дополнительный фактор      |
| Фишинг passkey                 | WebAuthn origin/rpID привязаны к консоли, user verification обязательна, challenge-cookie           |
| Кража/подмена passkey          | Управление только после TOTP, чужой credential не выбрать, аудит added/removed, нет секретов в логе |
| Подделка passkey-регистрации   | Gate `vendor_mfa_required`, проверка сессии и статуса, origin-check, rate limit                     |
| Атака через BFF                | Только два префикса, whitelist заголовков, лимиты 8/64 KiB, origin-check, API остаётся энфорсером   |
| Подбор пароля вендора          | password ≥ 12, per-email 5/60, Better Auth rate limit, lockout TOTP, единый ответ на reset          |
| Кража/повтор reset-токена      | одноразовый токен, TTL 30 минут, SHA-256 identifier в БД, отзыв сессий после сброса                 |
| Reset-токен в URL              | `no-referrer`, `noindex`, удаление из адресной строки после чтения, без аналитики и логов BFF       |
| Кража вендорской сессии        | HttpOnly/SameSite cookie, TTL 8 часов, отзыв при suspend/reset, origin guard, step-up               |
| Обход TOTP / сброс MFA         | TOTP обязателен для всех ролей, `/two-factor/disable` запрещён, reset-mfa только superadmin+аудит   |
| Passkey вместо TOTP            | Passkey не снимает `vendor_mfa_required`; password-only сессия не меняет пароль/сессии/ключи        |
| Эскалация вендорской роли      | guard `superadmin`, `confirmSuperadmin`, отказ `vendor_role_denied` в аудите                        |
| CSRF вендорской консоли        | Origin guard на `/v1/vendor/*` и `/api/vendor-auth/*`, SameSite cookie, origin-check BFF            |
| Per-IP лимиты за BFF           | BFF подписывает client IP; API проверяет HMAC, per-email 5/60 и lockout остаются                    |
| Audit IP за BFF                | Проверенный client IP из подписанного BFF-заголовка; иначе egress-IP BFF; `x-request-id`            |
| Подмена вендорского аудита     | append-only, HMAC-цепочка с ключом вне БД, `verify_vendor_audit_chain()`, дневной якорь             |
| Prompt injection через данные  | MCP не исполняет данные как инструкции; allowlist инструментов                                      |
| Подмена счета/оплаты           | append-only, аудит с хеш-цепочкой, права финансов                                                   |
| Компрометация цепочки поставок | lockfile, Dependabot, CodeQL, SBOM, подписанные релизы                                              |
| Утечка секретов                | secret scanning, `.env.example`, запрет секретов в PR                                               |

**Passkeys.** WebAuthn-credential привязан к `origin` консоли
(`VENDOR_BASE_URL`) и `rpID` (`VENDOR_WEBAUTHN_RP_ID`), поэтому фишинговая
страница на другом домене не сможет завершить ceremony. Плагин требует
`userVerification: "required"` и `residentKey: "required"`; вход
usernameless, без email и `allowCredentials`, поэтому выбрать чужой
non-discoverable ключ нельзя. Управление passkeys, смена пароля и отзыв
сессий закрыты до TOTP: украденный пароль не должен давать DoS владельцу.
Passkey-вход и sign-out не гейтятся. Потеря passkey не блокирует вход, пока
есть пароль и TOTP/backup-коды; сброс MFA удаляет и passkeys. Секреты,
credential ID и public key в аудит не пишутся. E2E — Chromium с виртуальным
authenticator; Safari/Firefox проверяются вручную.

**BFF.** Браузер общается только с origin консоли; Next.js BFF проксирует два
префикса в Fastify. Whitelist путей и заголовков, лимиты query 8 KiB и body
64 KiB, origin-check для небезопасных методов и таймаут 15 секунд не дают
превратить консоль в open proxy. BFF не добавляет прав: API остаётся
единственным энфорсером guard-ов. За BFF per-IP лимиты Better Auth и
глобальный Fastify-лимит видят egress-IP BFF и становятся instance-global;
первичная защита — per-email 5/60 и account lockout. Audit-события за BFF
фиксируют egress-IP BFF, а не клиентский; доверенный client IP требует выбора
хостинга и подписи заголовка (follow-up). CSP с nonce реализован в `apps/web/src/proxy.ts`:
`script-src 'self' 'nonce-…' 'strict-dynamic'`, `object-src 'none'`,
`base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`; в dev
разрешены `unsafe-eval` и websocket, в production —
`upgrade-insecure-requests`. Inline-стили разрешены для Tailwind/Radix.
Остальные заголовки: `no-referrer`, `nosniff`, `DENY`, `Permissions-Policy`,
COOP и HSTS вне local.

**Reset-токен в URL.** Ссылка ведёт на `/reset-password?token=…`; страница
читает токен, передаёт его Better Auth и удаляет из адресной строки
(`history.replaceState`). Действуют `Referrer-Policy: no-referrer` и
`noindex`; токен не пишется в аналитику, логи BFF и аудит. Это снижает утечку
через историю/referrer, но не отменяет остаточный риск хранения токена.

Reset-токены вендора хешируются: Better Auth 1.7.25 с
`verification.storeIdentifier: "hashed"` хранит в
`vendor_auth_verifications.identifier` только
`base64url(SHA-256("reset-password:<raw token>"))`. TTL 30 минут, одна
активация; сырой токен есть только в письме и URL. Строку по-прежнему читает
только роль `partner_coder_vendor_auth`, но дамп БД больше не раскрывает
действующие токены. Tenant magic-link и invitation-токены также хешируются
(`auth_verifications`, `invitations.token_hash`).

## 3. Приватность

- Храним только метаданные активности: счетчики ввода/фокуса, tool calls,
  ветки, задачи.
- Не храним: код, промпты, имена файлов, содержимое переписки, скриншоты.
- Согласие разработчика и директора; политика конфиденциальности; DPA.
- Шифрование in transit и at rest; минимизация PII; наименьшие привилегии.
- Экспорт и удаление данных; ретенция; аудит доступа.
- Хостинг в РФ; проверка 152-ФЗ с юристом.

## 4. Изоляция tenant

1. Все тенант-таблицы: `tenant_id NOT NULL`, RLS-политика.
2. Транзакция устанавливает `app.tenant_id`; API берет tenant из сессии/токена.
3. Вендорская роль не читает сырые heartbeat и код — только агрегаты и финансы.
4. Better Auth-таблицы доступны только роли `partner_coder_auth`; API-роль
   не имеет грантов на OTP/аккаунты/сессии других пользователей.
   `auth_rate_limits` доступна auth-роли, `email_rate_limits` — API-роли;
   worker удаляет просроченные окна при TTL-очистке (ADR-0012).
5. Вендорский auth-контур отделён от tenant: `partner_coder_vendor_auth`
   видит `vendor_users` и `vendor_auth_*`, `partner_coder_vendor` — вендорские
   данные без секретов; API/auth/worker не видят `vendor_auth_*`. RLS на
   вендорских таблицах нет — граница держится грантами и раздельными
   логинами, проверяется каталог-тестами (ADR-0013).
6. Тесты: чтение/запись чужого tenant по каждому ресурсу; матрица ролей;
   e2e приглашения и device-токена; fuzz IDOR — на пилоте.
7. Каждый отказ доступа пишется в аудит (`authz.denied` для tenant,
   `vendor.auth.role_denied` для вендора).

## 5. Аудит

- Append-only `tenant_audit_events` и `vendor_audit_events`.
- HMAC-цепочка: `prev_hash` + `hash` (HMAC-SHA-256), ключ
  `AUDIT_HMAC_KEY` вне БД; ежедневный якорь. Запись без ключа отклоняется
  (`audit_hmac_key_missing`), проверка с другим ключом возвращает false.
- Все опасные действия (политика, выплаты, споры, отзыв устройства,
  перевыпуск пакета) — обязательная запись.
- Вендорский контур пишет приглашения, bootstrap, смену роли/статуса, сброс
  пароля/MFA, отзыв сессий, step-up, вход/неуспешный вход, второй фактор,
  выход, смену пароля, добавление/удаление/переименование passkey и
  `vendor.auth.role_denied` через `vendor_audit()`; пароли, TOTP-секреты,
  backup-коды, reset-токены, credential ID и public key в журнал не попадают.
  Неуспешный вход хранит только `sha256(normalizedEmail)`. Целостность
  проверяется `verify_vendor_audit_chain()`.

## 6. План проверок

| Этап       | Проверка                                             |
| ---------- | ---------------------------------------------------- |
| PR         | lint, typecheck, unit/golden/property, secret scan   |
| main       | CodeQL, dependency review, e2e smoke                 |
| Релиз      | SBOM, подписи бинарников, проверка SmartScreen       |
| Пилот (M9) | внешний/независимый пентest, fuzz изоляции, нагрузка |

## 7. Раскрытие уязвимостей

См. `SECURITY.md`. Не публиковать детали до исправления; не создавать issue с
эксплойтом в публичном репозитории.
