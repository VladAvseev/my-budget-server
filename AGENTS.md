# AGENTS.md

## О проекте

REST-бэкенд приложения my-budget: Express + TypeScript + PostgreSQL. Модули в
`src/modules/_*`-port'ируют RPC-функции прежнего Supabase-бэкенда и обслуживают
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
- Миграция данных из Supabase: `db/migrate-from-supabase.mjs` читает источник
  через его REST/GoTrue API (`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`,
  secret-ключ обязателен — RLS с анонимным ключом вернул бы пустые таблицы);
  хэши паролей через API не доступны, поэтому пользователям выдаются
  временные пароли (печатаются в отчёте `--yes`). Запуск:
  `docker compose run --rm --no-deps -e SUPABASE_URL=... -e SUPABASE_SERVICE_ROLE_KEY=... api node db/migrate-from-supabase.mjs --dry-run`,
  затем с `--yes`.

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
  в таблицу `public.request_logs` (схема — `db/schema.sql`): метод/путь/query/тела,
  статус, длительность, user_id/is_authenticated/ip/user-agent. Автор — из
  `req.user`, который заполняет `authenticate`; пишется в `res.on('finish')`,
  поэтому к этому моменту уже известна роль. `is_authenticated` фиксирует факт
  авторизации на момент запроса и отличается от `user_id is null` (после
  `on delete set null` строки удалённого юзера остались бы «без авторизации»).
  Тела маскируются (`password`, `newPassword`, `refreshToken` → `'***'`),
  урезаются до 4 КБ; `/health` и вся админ-панель (`/api/v1/admin/*`) не
  логируются; вставка fire-and-forget. Env: `LOG_BODIES` (по умолчанию `true`),
  `LOG_RETENTION_DAYS` (по умолчанию 30, устаревшие
  строки middleware удаляет сам, вероятностно ~1 раз на 200 запросов).
  Просмотр/метрики — `GET /admin/logs` (фильтры `status`, `userId=<uuid>` или
  `userId=anonymous` — только запросы без авторизации), `GET /admin/logs/metrics`
  (вкладка «Логи» админ-панели клиента; email автора тянется `LEFT JOIN users`).
- **Formatting:** single quotes, semicolons, 2-space indent, trailing commas, 100-char width
- **Точка входа:** `src/index.ts` загружает dotenv и стартует сервер
- **Конфигурация:** `.env` файл (не `.env.example`)

## Типичная ошибка

- Не забывать `.js` расширение в импортах (ESM требует явного расширения)
- `console.log` вызывает ESLint-warn — использовать `console.error` или `console.warn` для логирования
