# @partner-coder/ui

Общие React-компоненты кабинетов. В M3 PR B пакет используется вендорской
консолью (`apps/web`): примитивы, layout-элементы и переключатель темы. Те же
компоненты будут переиспользованы кабинетами директора и разработчика (M5).

## Компоненты

- Формы и действия: `Button`, `Input`, `PasswordInput`, `Label`, `Field`,
  `Checkbox`, `CodeInput`, `CopyButton`, `Spinner`.
- Композиция: `Card`, `Alert`, `Badge`, `Dialog`, `AlertDialog`,
  `DropdownMenu`, `Separator`, `Skeleton`, `EmptyState`, `PageHeader`,
  `BrandMark`, `Toaster`.
- Тема: `ThemeToggle` (`next-themes`; провайдер и класс темы задаёт
  приложение).
- Утилиты: `cn`, `normalizeOtp`, `normalizeBackupCode`.

Экспорты — из `src/index.ts`; интерактивные компоненты помечены
`"use client"`, презентационные остаются серверно-совместимыми.

## Токены и тема

Семантические CSS-переменные (`background`, `foreground`, `card`, `muted`,
`border`, `primary`, `destructive`, `success`, `warning`, `ring`, `radius`)
живут в `apps/web/src/app/globals.css`; `@source` включает
`packages/ui/src`, чтобы Tailwind 4 видел классы пакета. Пакет не содержит
глобального CSS и не задаёт брендбук: приложение может заменить палитру
токенами. Светлая/тёмная тема — через `next-themes` (`system` по умолчанию),
без внешних font-CDN: Inter Variable подключается приложением.

## Сборка

```bash
pnpm --filter @partner-coder/ui build      # tsc -p tsconfig.json → dist
pnpm --filter @partner-coder/ui typecheck
```

`package.json` экспортирует `dist/index.js` и `dist/index.d.ts`; приложение
зависит от пакета как `workspace:*`, поэтому перед `next build` нужен
`pnpm build` (Turborepo делает это через `dependsOn: ["^build"]`).

## Правила

- Русский UI; строки — в каталоге приложения, не в компонентах.
- Каждая денежная/долевая цифра форматируется из целых единиц домена
  (`formatRoubles`, `shareUnitsToPercent`, `basisPointsToPercent`).
- Никаких расчетов в компонентах: только отображение готовых значений.
- Доступность: labels, видимый focus, keyboard-only, `aria-live` для
  статусов; минимум 44×44 px для действий.
