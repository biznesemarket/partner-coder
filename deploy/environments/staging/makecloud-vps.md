# PostgreSQL 17 на VPS MakeCloud

Статус: runbook для self-hosted PostgreSQL. На реальном сервере не выполнялся.
MakeCloud предоставляет VPS, а не managed PostgreSQL: обновления, бэкапы и
восстановление выполняет наша сторона.

## 1. Архитектура

- Отдельный VPS для staging и отдельный для production.
- Не размещать staging и production в одном кластере PostgreSQL: роли
  кластерные, имена `partner_coder_*` совпадут.
- ОС: Ubuntu 24.04 LTS.
- Минимум для staging: 2 vCPU, 4 ГБ RAM, 60 ГБ SSD.
- Минимум для production: 4 vCPU, 8 ГБ RAM, 120 ГБ SSD.
- S3 MakeCloud — отдельный bucket для бэкапов каждого окружения.
- PgBouncer в MVP не используем. Если появится — worker только через
  session pooling.

## 2. Создание сервера

1. Зарегистрировать VPS в панели MakeCloud.
2. Выбрать Ubuntu 24.04 LTS, Москва.
3. Добавить SSH-ключ, не использовать пароль для root.
4. Записать публичный IP.
5. В DNS создать `db.staging.pcoder.ru` и `db.pcoder.ru` (или использовать
   приватный IP, если сеть позволяет).

## 3. Первичная защита

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y ufw fail2ban unattended-upgrades ca-certificates curl
sudo timedatectl set-timezone UTC
```

SSH:

```bash
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
sudo systemctl restart ssh
```

Firewall (заменить `APP_IP` на адрес API/worker):

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow from APP_IP to any port 5432 proto tcp
sudo ufw enable
```

Не открывать 5432 для всего интернета.

## 4. Установка PostgreSQL 17

```bash
sudo apt install -y postgresql-common
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh
sudo apt install -y postgresql-17 postgresql-client-17
sudo systemctl enable --now postgresql
psql --version
```

## 5. Базовая настройка

Файл `/etc/postgresql/17/main/postgresql.conf`:

```conf
listen_addresses = 'localhost,PRIVATE_IP'
max_connections = 100
shared_buffers = 1GB
effective_cache_size = 3GB
maintenance_work_mem = 256MB
wal_level = replica
archive_mode = on
archive_command = 'pgbackrest --stanza=partner_coder archive-push %p'
archive_timeout = 60
ssl = on
ssl_cert_file = '/etc/postgresql/17/main/server.crt'
ssl_key_file = '/etc/postgresql/17/main/server.key'
ssl_ca_file = '/etc/postgresql/17/main/ca.crt'
```

Значения `shared_buffers` и `effective_cache_size` подобрать под RAM сервера.

## 6. TLS для подключений

Сгенерировать приватный CA и серверный сертификат:

```bash
cd /etc/postgresql/17/main
sudo openssl req -new -x509 -days 3650 -nodes -text \
  -out ca.crt -keyout ca.key -subj "/CN=pcoder-db-ca"
sudo openssl req -new -nodes -text \
  -out server.csr -keyout server.key -subj "/CN=db.pcoder.ru"
sudo openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key \
  -CAcreateserial -out server.crt -days 3650 -text
sudo chown postgres:postgres ca.crt ca.key server.crt server.key
sudo chmod 600 ca.key server.key
sudo chmod 644 ca.crt server.crt
```

`ca.crt` передать API/worker и использовать `sslmode=verify-full`.
Приватный ключ CA хранить в менеджере секретов и вне сервера приложений.

## 7. Доступы PostgreSQL

В `/etc/postgresql/17/main/pg_hba.conf`:

```conf
local   all             postgres                                peer
local   all             all                                     scram-sha-256
hostssl all             all             127.0.0.1/32            scram-sha-256
hostssl all             all             APP_SUBNET              scram-sha-256
```

Создать БД и роли:

```sql
create database partner_coder;
\c partner_coder

create role partner_coder_api nologin;
create role partner_coder_auth nologin;
create role partner_coder_vendor nologin;
create role partner_coder_vendor_auth nologin;
create role partner_coder_worker nologin bypassrls;
create role partner_coder_retention nologin;
```

Пароли и login-роли — по `managed-postgres.md`, вариант A. Для self-hosted
PostgreSQL администратор `postgres` является superuser, поэтому
`ALTER ROLE ... BYPASSRLS` доступен.

## 8. Миграции и pg-boss

```bash
DATABASE_URL='postgres://pc_migrator:...@db.pcoder.ru:5432/partner_coder?sslmode=verify-full' \
  pnpm db:migrate
DATABASE_URL='...' pnpm db:check
```

Схему `pgboss` создаёт worker или администратор:

```sql
create schema if not exists pgboss authorization pc_worker_login;
```

## 9. Бэкапы в S3 MakeCloud

Установить pgBackRest:

```bash
sudo apt install -y pgbackrest
```

`/etc/pgbackrest/pgbackrest.conf`:

```conf
[global]
repo1-type=s3
repo1-s3-bucket=BUCKET
repo1-s3-endpoint=S3_ENDPOINT
repo1-s3-region=ru-msk
repo1-s3-key=S3_KEY
repo1-s3-key-secret=S3_SECRET
repo1-path=/pgbackrest
repo1-retention-full=30
repo1-retention-archive=30
process-max=2
log-level-console=info
compress-type=zst

[partner_coder]
pg1-path=/var/lib/postgresql/17/main
```

Секреты S3 хранить в менеджере секретов, не в git.

```bash
sudo -u postgres pgbackrest --stanza=partner_coder stanza-create
sudo -u postgres pgbackrest --stanza=partner_coder --type=full backup
sudo -u postgres pgbackrest --stanza=partner_coder check
```

Ежедневный full backup через systemd timer или cron:

```conf
# /etc/cron.d/pgbackrest
0 2 * * * postgres pgbackrest --stanza=partner_coder --type=full backup
```

WAL архивируется непрерывно через `archive_command`; это даёт RPO около
15 минут.

## 10. Restore drill

1. Создать отдельный тестовый VPS или отдельный каталог.
2. Остановить PostgreSQL.
3. Выполнить `pgbackrest --stanza=partner_coder --delta restore`.
4. Запустить PostgreSQL.
5. Проверить `verify_tenant_audit_chain()` и `verify_vendor_audit_chain()`.
6. Прогнать smoke API/worker/web.
7. Зафиксировать RPO/RTO в журнале.

Не считать бэкап рабочим, пока restore drill не выполнен.

## 11. Мониторинг

- `pg_isready` каждую минуту.
- Свободное место на диске.
- Размер WAL и очередь архивации.
- `pg_stat_statements` для медленных запросов.
- Ошибки PostgreSQL в journald.
- Алерты в Telegram/MAX; получатель — владелец и техадминистратор.

## 12. Обновления

- Ежемесячно: `apt update && apt upgrade`.
- PostgreSQL minor-обновления — через пакеты PGDG.
- Перед обновлением — fresh backup.
- Мажорное обновление PostgreSQL 17 → 18 только по отдельному плану.

## 13. Критерии готовности

- `pnpm db:migrate` и `pnpm db:check` проходят.
- API и worker стартуют без `role_separation_failed`.
- `/readyz` зелёный.
- Worker видит tenant-данные.
- В `pg_stat_activity` нет runtime-соединений под superuser.
- `pgbackrest check` и restore drill успешны.
- Firewall не открывает 5432 в интернет.
- Секреты не хранятся в git.
