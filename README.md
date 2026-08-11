# Notification Service

Управление пользователями WireGuard VPN с Telegram-уведомлениями и дашбордом.

## Стек

Bun + Hono (TypeScript), Docker + Caddy (SSL), Telegram Bot API (curl), single-file HTML dashboard.

## Структура

```
src/
  index.ts        — вход: Hono + cron (подписки каждые 24ч)
  bot.ts          — Telegram API: отправка, broadcast, уведомления
  api/routes.ts   — REST API: пользователи, оплата, шаблоны, статистика
  db/index.ts     — чтение/запись JSON-файлов
  db/types.ts     — TypeScript-типы
web/
  dashboard.html  — фронтенд дашборда
Caddyfile, Dockerfile, docker-compose.yml
```

## Файлы данных

| Файл | Описание |
|---|---|
| `database.json` | Пользователи, доступы, конфиги (чтение каждые 30 сек, **без записи**) |
| `payments.json` | Оплата, тип (paid/free), имя |
| `notification_log.json` | Лог отправленных уведомлений |
| `message_templates.json` | Шаблоны сообщений |

## Дашборд

Дашборд доступен по адресу `https://your-domain.com/`. Вход по паролю из переменной `WEB_SECRET`.

## Автоуведомления

| Событие | Шаблон | Когда |
|---|---|---|
| Новый пользователь | Инструкция | Первое появление в БД |
| Первый трафик | Оплата | `totalRx > 0` при ранее `0` |
| Истекает за3 дня | Напоминание | Каждый день в9:00, один раз |
| Просрочка | Оплата | После окончания, один раз |

## Переменные окружения (.env)

```
NOTIFICATION_BOT_TOKEN=   # Токен Telegram-бота
WEB_PORT=3000
WEB_SECRET=               # Пароль дашборда
DOMAIN=                   # Домен для Caddy (SSL)
```

## Деплой

```bash
docker compose up -d
```

Caddy автоматически получит SSL-сертификат от Let's Encrypt.

## Docker

```
notification-service (:3000) ◄─── Caddy (:80, :443)
```

- bot_data — read-only, от основного бота
- notification_data — свои данные
- Порт 3000 не публикуется наружу
