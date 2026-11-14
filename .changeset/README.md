# Changesets

Изменения, влияющие на поведение продукта, сопровождаются changeset:

```bash
pnpm changeset          # выбрать пакеты и тип изменения
pnpm changeset version  # применить версии (делает релиз-инженер)
```

Доменные изменения (`@partner-coder/domain`) — минимум `minor`, если меняются
формулы или golden-числа (только вместе с ADR).
