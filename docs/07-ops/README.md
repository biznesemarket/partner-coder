# Эксплуатация

Сейчас доступно:

- `deploy/environments/staging/README.md` — роли БД, pg-boss, порядок выката,
  smoke API/worker и ограничения staging;
- `deploy/environments/staging/managed-postgres.md` — роли и проверки managed
  PostgreSQL;
- `deploy/environments/staging/makecloud-vps.md` — PostgreSQL 17 на VPS
  MakeCloud, TLS, бэкапы и restore drill;
- `retention-sla.md` — предложение по срокам хранения, бэкапам, SLA и
  поддержке;
- метрики API `/metrics` и worker `:4100/metrics`, pino-логи с redaction;
- ADR-0011 — семантика заданий, якорей и retention.

Будут добавлены в M9:

- runbooks: сбой закрытия дня, очередь, вебхуки, email, git, оплата, утечка;
- статус-страница;
- профиль нагрузки и результаты.

Локальная инфраструктура: `deploy/compose/docker-compose.yml`.
