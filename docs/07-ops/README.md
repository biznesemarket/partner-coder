# Эксплуатация

Сейчас доступно:

- `deploy/environments/staging/README.md` — роли БД, pg-boss, порядок выката,
  smoke API/worker и ограничения staging;
- метрики API `/metrics` и worker `:4100/metrics`, pino-логи с redaction;
- ADR-0011 — семантика заданий, якорей и retention.

Будут добавлены в M9:

- runbooks: сбой закрытия дня, очередь, вебхуки, email, git, оплата, утечка;
- бэкапы, PITR, restore drill, RPO/RTO;
- алерты и дежурство;
- статус-страница;
- профиль нагрузки и результаты.

Локальная инфраструктура: `deploy/compose/docker-compose.yml`.
