# Политика проекта: схема, версии, валидация

| Поле      | Значение                                                        |
| --------- | --------------------------------------------------------------- |
| Код       | DOMAIN-POLICY                                                   |
| Версия    | 2.0 (TypeScript)                                                |
| Статус    | Нормативный документ; реализация — `packages/domain/src/policy` |
| Связанные | ADR-0003, `calculator.md`, `economics.md`                       |

## 1. Где живет политика

Политика — версионируемый документ проекта (JSONB в БД, файл в фикстурах для
тестов и онбординга). Имена полей — `snake_case`, как в нормативной
спецификации; в коде политика нормализуется в `ProjectPolicy` с точными
дробями и копейками.

Канонический пример: `packages/domain/fixtures/policies/demo.policy.json`.

## 2. Блоки

### meta

| Поле                      | Тип               | Описание                                 |
| ------------------------- | ----------------- | ---------------------------------------- |
| `schema_version`          | string            | версия схемы (`1.0`)                     |
| `policy_version`          | int ≥ 1           | номер версии, растет с каждым изменением |
| `tenant_id`, `project_id` | string            | принадлежность                           |
| `approved_by`             | string            | кто утвердил                             |
| `effective_from`          | ISO-8601 с поясом | момент вступления в силу                 |

### project

`name`, `forge` (`github` \| `gitlab` \| `gitea` \| `forgejo`), `repo`,
`timezone` (IANA), `default_branch`.

### economics

`valuation_rub`, `rate_rub_per_hour` (текущие значения, сверяются с версиями),
`currency` (`RUB`), `pool_pct`, `founder_floor_pct`, `cash_share_pct`,
`cash_payment_schedule`, `revaluation_notice_days`, `pool_info_pct`, `pool_warn_pct`.

### time

`mode`, `heartbeat_interval_sec`, `active_window_sec`, `presence_window_sec`,
`idle_timeout_sec`, `max_clock_skew_sec`, `k_supervised`, `k_autonomous`,
`daily_cap_hours`, `autonomous_paid_cap_hours`, `k_quality_default`,
`manual_only_policy`, `require_task_link`.

### day

`close_at`, `late_grace_hours`, `dispute_window_days`, `digest_hour`, `digest_channels`.

### vesting

`enabled`, `months`, `cliff_months`, `active_month_rule`,
`active_month_min_paid_hours`, `active_month_min_amount_rub`, `cash_vesting`,
`acceleration`, `control_change_threshold_pct`, `inactive_pause_months`.

### versions

```json
{
  "rate": [
    {
      "effective_from": "2026-11-01T00:00:00+03:00",
      "value": 500,
      "reason": "…",
      "approved_by": "director"
    }
  ],
  "valuation": [
    {
      "effective_from": "2026-11-01T00:00:00+03:00",
      "value": 10000000,
      "reason": "…",
      "approved_by": "director",
      "adr_ref": "ADR-0003"
    }
  ]
}
```

### quality / security / identity / storage / legal

Модуль качества (`enabled: false` по умолчанию, границы `k_min…k_max`),
антифрод-пороги, лимиты аккаунтов, ретенция и якорь в git, юридический модуль
(`enabled: false`, все поля необязательны).

## 3. Валидация

| ID   | Проверка                                                                            |
| ---- | ----------------------------------------------------------------------------------- |
| V-01 | в каждом массиве версий ≥ 1 запись                                                  |
| V-02 | `effective_from` строго возрастает                                                  |
| V-03 | значение версии > 0                                                                 |
| V-04 | новая версия не раньше начала текущих открытых суток                                |
| V-05 | у версии оценки есть `adr_ref`                                                      |
| V-06 | причина ≥ 5 символов, `approved_by` заполнен                                        |
| V-07 | `economics.rate_rub_per_hour` = версия ставки, действующая на `meta.effective_from` |
| V-08 | `economics.valuation_rub` = версия оценки, действующая на `meta.effective_from`     |

Кросс-полевые проверки: `pool_pct + founder_floor_pct ≤ 100`; `cash_share_pct`
в 0…100; пороги пула возрастают (`info < warn ≤ 100`); кап автономного класса
≤ дневного капа; коэффициенты в 0…3; известный часовой пояс; клифф ≤ срока
вестинга; `manual_only_policy = bill` запрещен (422).

Проценты должны быть представимы в целых базисных пунктах (не более двух
знаков после запятой), иначе ошибка `P-precision`.

## 4. Форвард-онли изменения

- Существующие версии `rate` и `valuation` неизменяемы (сравнение по
  `effective_from` и значению; ошибка `C-immutable`).
- Новая версия не может действовать раньше начала текущих открытых суток
  (`V-04`).
- Прошлые закрытые дни не пересчитываются (ADR-0007).

Реализация: `validatePolicyUpdate(previous, next, atMs, timeZone, startOfDayMs)`.

## 5. Применение

1. `loadPolicy(raw)` — схема + V-01…V-08 + нормализация (одна точка входа).
2. `policyVersionId` пишется в дневную запись вместе с `inputHash`.
3. SHA-256 документа политики сохраняется для аудита.

## История изменений

| Версия | Дата       | Изменение                                                   |
| ------ | ---------- | ----------------------------------------------------------- |
| 2.0    | 2026-11-15 | TypeScript-схема, V-04 как проверка обновления, P-precision |
| 1.0    | 2026-11-13 | Полная схема переменных (Python-проект)                     |
