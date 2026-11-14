# Калькулятор дня: конвейер, инварианты, объяснения

| Поле      | Значение                                                                         |
| --------- | -------------------------------------------------------------------------------- |
| Код       | DOMAIN-CALC                                                                      |
| Версия    | 2.0 (TypeScript)                                                                 |
| Статус    | Нормативный документ; реализация — `packages/domain/src/economics/calculator.ts` |
| Связанные | `time-accounting.md`, `economics.md`, ADR-0003, ADR-0007                         |

## 1. Вход

```ts
type CalculateDayInput = {
  policy: ProjectPolicy; // нормализованная политика
  date: string; // локальная дата YYYY-MM-DD
  sessions: SessionInput[]; // интервалы уже классифицированы
  facts?: DayFacts; // tool calls, коммиты, PR-диффы, skew, replay
  quality?: { kQuality; reason } | null;
  pool?: { accruedEquityKopecks } | null;
  previous?: ClosedDaySnapshot | null; // для идемпотентности и компенсаций
};
```

Интервал: `{ class, start, end, source?, receivedAt? }`, где `start`/`end` —
ISO-8601 UTC. `source: "manual"` помечает работу без агента.

## 2. Выход

```ts
type DayCalculation = {
  paidSeconds: number;
  trackedSeconds: number; // учтено, но не оплачено
  classes: { activeSeconds; supervisedSeconds; autonomousSeconds; idleSeconds };
  caps: { dailyApplied: boolean; autonomousApplied: boolean };
  amountKopecks: bigint;
  cashKopecks: bigint;
  equityKopecks: bigint;
  shareBp: bigint; // единицы 1e-6: 330 = 0,0330 %
  poolUsedBp: bigint; // базисные пункты: 10000 = 100 %
  poolPending: boolean;
  pendingEquityKopecks: bigint;
  flags: DayFlag[];
  versions: { policyVersionId; rateVersionIds; valuationVersionId };
  inputHash: string;
  idempotent: boolean;
  adjustmentKopecks: bigint | null;
  explanation: ExplanationNode;
};
```

## 3. Конвейер

```text
dayWindowUtc(date, timezone)                 → окно суток (23/24/25 ч при DST)
activeVersion(valuation, startOfDay)          → оценка дня
versionBoundariesWithin(rate, window)         → точки смены ставки
для каждого интервала:
  clip по окну суток
  late-проверка (receivedAt − end > late_grace)     → tracked, флаг late_rejected
  пустой / idle                                     → tracked или классы
  source=manual                                     → manual_only_policy
  нет task_ref/branch при require_task_link         → tracked, флаг no_task_link
unionTimeline(paid)                           → R3 + запрет двойной оплаты
splitAtBoundaries(rateBoundaries)             → R4
взвешенные секунды по классам                 → R5 коэффициенты
кап автономного класса                        → autonomousPaid
дневной кап с приоритетом усечения            → active > supervised > autonomous
распределение усечения по отрезкам пропорционально
amount = ROUND_HALF_UP(Σ(sec × rate) × k_quality / 3600)
cash / equity                                 → E-06
poolStatus(accrued + equity)                  → used_bp, pending
shareBp = pending ? 0 : equity × 1e6 / valuation
флаги дня                                     → R16
inputHash = sha256(canonicalJson(inputs))     → идемпотентность
```

## 4. Решения и уточнения

| ID   | Решение                                                       | Почему                                                                |
| ---- | ------------------------------------------------------------- | --------------------------------------------------------------------- |
| R-01 | Доля дня считается от `equity`                                | Согласовано с «денежная часть уменьшает вклад»; E-01/E-02 не меняются |
| R-02 | Union объединяет интервалы **разных** классов по приоритету   | Инвариант 6: один интервал не оплачивается дважды                     |
| R-03 | Усечение капом распределяется пропорционально по отрезкам     | Смена ставки внутри дня не искажает сумму                             |
| R-04 | `pending` определяется после добавления вклада дня            | День, пересекший лимит, уже не увеличивает долю                       |
| R-05 | Пустые интервалы (`start == end`) пропускаются                | Устойчивость к граничным событиям                                     |
| R-06 | Интервал между heartbeat кредитуется не дольше `idle_timeout` | Защита от offline-накрутки                                            |
| R-07 | `manual_only_policy = bill` → 422                             | Зарезервированный режим без ADR                                       |
| R-08 | `no_output` вычисляется только при переданных `facts`         | Нельзя ставить флаг без данных о результате                           |

## 5. Ошибки

| Код                                | HTTP | Когда                                  |
| ---------------------------------- | ---- | -------------------------------------- |
| `invalid_interval`                 | 400  | конец раньше начала, некорректная дата |
| `manual_only_policy_not_supported` | 422  | `manual_only_policy = bill`            |
| `policy_violation`                 | 409  | `k_quality ≤ 0` или нет обоснования    |
| `no_active_version`                | 409  | нет версии ставки/оценки на дату       |

## 6. Инварианты и property-тесты

1. Закрытая дневная запись не обновляется и не удаляется.
2. Эффективная сумма дня = база + корректировки.
3. Повторный расчет с теми же входами идемпотентен (`inputHash`).
4. Изменившийся расчет создает компенсацию, не перезапись.
5. Ставка и оценка не меняются задним числом.
6. Один отрезок не оплачивается дважды.
7. Сессия без задачи не оплачивается.
8. День принадлежит tenant и проекту.
9. Деньги — целые копейки, доля — целые единицы, время — целые секунды.
10. Любая цифра раскладывается до интервалов и версий политики.

Property-тесты (`src/property.test.ts`): union не увеличивает время и
идемпотентен; капы не превышаются; `cash + equity = amount`; деньги
неотрицательны; доля монотонна по вкладу при равной оценке; half-up на целых
возвращает то же число.

## 7. Объяснение

`explanation` — дерево `ExplanationNode { op, label, value, children }`.
Корень `day_calculation` содержит: окно суток, классы, капы, отрезки ставки,
экономику (часы, amount, cash, equity, доля, пул) и флаги. UI показывает
дерево в drawer «как посчитано».

## 8. Производительность

Целевой профиль — 100 000 интервалов на день без деградации: конвейер
линейный (сортировка + sweep), без вложенных циклов по интервалам.

## История изменений

| Версия | Дата       | Изменение                                              |
| ------ | ---------- | ------------------------------------------------------ |
| 2.0    | 2026-11-15 | TypeScript-конвейер, решения R-01…R-08, property-тесты |
