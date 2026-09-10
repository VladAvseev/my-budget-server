# AGENTS.md

## О проекте

REST-бэкенд приложения my-budget: Express + TypeScript + PostgreSQL. Модули в
`src/modules/_*` повторяют контракты прежнего RPC-бэкенда (формы ответов
зеркальные, чтобы клиент при переезде не менялся) и обслуживают
фронтенд `client/` (тот ходит на `/api/v1` через `src/shared/api/http.ts`).

## Деплой и инфраструктура

- Продакшн: Docker Compose на сервере Reg.ru (`/opt/mybudget/server`),
  стек `db` (postgres:16) + `api` (этот репозиторий) + `web` (клон `client/`);
  секреты — в локальном `.env` на сервере (не в git).
- Схема БД: `db/schema.sql` (полная, рассчитана на пустую базу — на живой БД
  целиком не запускать), применяется автоматически при первом старте тома
  `pgdata`; дальнейшие правки — двумя коммитами: в `db/schema.sql` (для свежих
  установок) и отдельным идемпотентным файлом в `db/migrations/` для догона
  боевой БД. Применение: `docker compose exec db psql -U mybudget -d mybudget`
  и вставить содержимое файла (либо `-f - < db/migrations/<file>.sql`).
- CI (`.gitlab-ci.yml`): build+lint+typecheck, job `deploy-api` (активен после
  заведения `DEPLOY_SSH_KEY` в Variables), зеркало в GitHub.

## Схема и данные

- Единственный источник данных — собственный PostgreSQL (`db/schema.sql`).
  Внешних бэкендов и синхронизации с ними нет.
- Правки живой базы — только идемпотентными файлами `db/migrations/*.sql`
  (исторические грабли, которые они чинят, описаны в их шапках).
- `users.last_active_at` — отметка активности: её двигает
  `src/middlewares/authMiddleware.ts` на каждом авторизованном запросе
  (не чаще раза в 15 минут). Триггера на вставку операций в схеме нет
  сознательно: он портил дату при пакетной загрузке исторических операций.
  Активность пользователей, не заходивших с момента переноса базы,
  выставлена в дату регистрации (см.
  `db/migrations/2026-09-11-reset-last-active-to-created-at.sql`).

## Стек

- **Фреймворк:** Express
- **HMR:** Nodemon + tsx
- **Язык:** TypeScript (strict mode)
- **Линтер:** ESLint 9 (flat config)
- **Форматтер:** Prettier
- **Окружение:** Node.js с ES-модулями (`"type": "module"`)

## Команды

```bash
npm install          # установить зависимости
npm run dev          # запуск с HMR (nodemon + tsx)
npm run build        # компиляция в dist/
npm run start        # запуск из dist/
npm run lint         # проверка ESLint
npm run format       # форматирование Prettier
npm run typecheck    # проверка типов без компиляции
```

Порядок проверки перед коммитом: `lint → typecheck → test`

## Структура проекта

```
src/
  index.ts                     — точка входа
  app.ts                       — Express-приложение (middleware, монтирование /api/v1)
  router.ts                    — корневой роутер API (подключает роутеры модулей)
  middlewares/                 — authenticate, requireAdmin, rate-limit,
                                 error/notFound, requestLogging (логи в БД)
  modules/
    _<moduleName>/
      router.ts      — определение роутов
      controller.ts  — HTTP-слой (приём запроса, отдача ответа)
      service.ts     — бизнес-логика
      repository.ts  — работа с данными / БД
      types.ts       — типы модуля
```

Каждый бизнес-модуль — отдельная папка `_moduleName` со всем необходимым внутри. Папки модулей начинаются с `_` для визуального отделения от инфраструктурного кода.

## Проектирование REST API

### Версионирование

- Все эндпоинты находятся под префиксом `/api/v1`.
- Префикс монтируется единожды в `src/app.ts` (`app.use('/api/v1', apiRouter)`). В `src/router.ts` и роутерах модулей версии в путях быть не должно.
- Ломающие изменения контракта — новый префикс `/api/v2`, а не правка поведения существующих v1-эндпоинтов.

### Именование ресурсов

- Ресурсы — существительные во множественном числе: `/users`, а не `/user` и не `/getUsers`.
- Никаких глаголов в URL; действие передаётся HTTP-методом.

### Базовый CRUD-набор (пример: Users)

| Метод и путь        | Назначение        | Коды ответов                  |
| ------------------- | ----------------- | ----------------------------- |
| `GET /users`        | список коллекции  | 200                           |
| `GET /users/{id}`   | одна сущность     | 200, 404                      |
| `POST /users`       | создание          | 201 (+ заголовок `Location`), 400 |
| `PUT /users/{id}`   | полная замена     | 200, 404                      |
| `PATCH /users/{id}` | частичное обновление | 200, 404                   |
| `DELETE /users/{id}`| удаление          | 204, 404                      |

- Пагинация, сортировка и фильтрация коллекции — через query-параметры: `GET /users?page=1&limit=20&sort=createdAt`.
- GET, PUT и DELETE идемпотентны; GET не мутирует состояние.
- Ошибки — через `AppError` и `errorMiddleware` (`src/shared/appError.ts`, `src/middlewares/errorMiddleware.ts`), в едином формате ответа.

### Вложенность сущностей

- Принадлежность одной сущности другой выражается путём, а не глаголом или фильтром вида `by_userId` в URL:
  - ✅ `GET /users/{userId}/budgets` — список бюджетов пользователя
  - ✅ `GET /users/{userId}/budgets/{id}` — конкретный бюджет пользователя
  - ❌ `GET /budgets/by_userId/{userId}`, `GET /users/{id}/get-budgets`
- Если связь — не владение, а фильтрация коллекции, используется обычный query-параметр с именем поля: `GET /budgets?userId={id}` (не `?by_userId=`).
- Максимальная глубина вложенности — 2 уровня (`/users/{userId}/budgets/{id}`); глубже — выносить в query-фильтры.

## Конвенции

- **Path alias:** `@/` → `./src/` (настроен в `tsconfig.json`)
- **Импорт типов:** использовать `import type` ( enforced ESLint + TS)
- **Логирование запросов:** `requestLoggingMiddleware` пишет каждый HTTP-запрос
  в таблицу `public.request_logs` (схема — `db/schema.sql`): дата/время, метод,
  путь, статус, длительность, текст ошибки, user_id/user_role/is_authenticated, ip.
  Автор — из
  `req.user`, который заполняет `authenticate`; пишется в `res.on('finish')`,
  поэтому к этому моменту уже известен статус. `user_role` — роль автора из
  JWT-claim на момент запроса ('user' | 'admin', null для неавторизованных):
  фиксируется именно тогда, т.к. роль в `users` со временем может измениться.
  `is_authenticated` фиксирует факт
  авторизации на момент запроса и отличается от `user_id is null` (после
  `on delete set null` строки удалённого юзера остались бы «без авторизации»).
  Тела запроса и ответа, query и User-Agent в базу НЕ пишутся — они занимали
  основной объём таблицы и светили данные; текст ошибки извлекается на лету из
  envelope `{ error: { message } }` и сохраняется только для статусов >= 400
  (обрезается до 512 символов). UUID- и числовые сегменты пути пишутся как `:id`
  (`/api/v1/reports/:id`) — иначе метрики топов группировали бы каждый id
  отдельно; `/health` и вся админ-панель (`/api/v1/admin/*`) не
  логируются; вставка fire-and-forget. Env:
  `LOG_RETENTION_DAYS` (по умолчанию 30, устаревшие
  строки middleware удаляет сам, вероятностно ~1 раз на 200 запросов).
  Просмотр/метрики — `GET /admin/logs` (фильтры `status`, `userId=<uuid>` или
  `userId=anonymous` — только запросы без авторизации; сортировка
  `sort=date|duration` + `order=asc|desc`, по умолчанию свежие сверху),
  `GET /admin/logs/metrics`
  (вкладка «Логи» админ-панели клиента; email автора тянется `LEFT JOIN users`;
  строка с ошибкой раскрывается по клику и показывает текст ошибки).
  График динамики логов — `GET /admin/logs/dynamics?audience=all|users`:
  считает логи по МСК-часам (`date_trunc('hour', created_at AT TIME ZONE
  'Europe/Moscow')`), аудитория `users` фильтрует по `user_role = 'user'`
  (без админов и без неавторизованных); день клиент агрегирует из часов сам.
  Тот же `audience=all|users` есть у `GET /admin/dashboard/operations-dynamics`
  (для `users` операции фильтруются JOIN'ом `users.role = 'user'` по
  `operations.user_id`). `user_role` в существующих строках проставлена
  идемпотентной миграцией `db/migrations/2026-09-11-request-logs-user-role.sql`
  через `user_id → users.role` (у неавторизованных и удалённых авторов роль
  остаётся NULL — восстановить по почте нельзя, она в логах не хранилась).
- **Formatting:** single quotes, semicolons, 2-space indent, trailing commas, 100-char width
- **Точка входа:** `src/index.ts` загружает dotenv и стартует сервер
- **Конфигурация:** `.env` файл (не `.env.example`)

## Типичная ошибка

- Не забывать `.js` расширение в импортах (ESM требует явного расширения)
- `console.log` вызывает ESLint-warn — использовать `console.error` или `console.warn` для логирования
