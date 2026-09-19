# AGENTS.md

## О проекте

REST-бэкенд приложения my-budget: Express + TypeScript + PostgreSQL. Модули в
`src/modules/_*` повторяют контракты прежнего RPC-бэкенда (формы ответов
зеркальные, чтобы клиент при переезде не менялся) и обслуживают
фронтенд `client/` (тот ходит на `/api/v1` через `src/shared/api/http.ts`).

## Деплой и инфраструктура

- Продакшн: Docker Compose на сервере Reg.ru (`/opt/mybudget/server`),
  стек `db` (postgres:16) + `api` (этот репозиторий) + `web` (клон `client/`);
  секреты — в локальном `.env` на сервере (не в git). Единственное исключение
  по способу попадания: `CONSENT_ENC_KEY` job `deploy-api` одноразно засевает
  в `.env` из masked-переменной GitLab `CONSENT_ENC_KEY` (без Protected;
  существующее значение не перезаписывается — старые записи consent_log
  расшифровываются только исходным ключом, ротация только руками).
- Сетевой периметр сервера: ufw (наружу только 22/80/443) + fail2ban
  (jail.local: sshd/nginx-botsearch/recidive, баны через ufw). Локальные
  файлы и порядок восстановления — в `deploy/fail2ban/README.md`; на свежей
  машине разворачивать оттуда, shipped-конфиги fail2ban не править.
- Схема БД: `db/schema.sql` (полная, рассчитана на пустую базу — на живой БД
  целиком не запускать), применяется автоматически при первом старте тома
  `pgdata`; дальнейшие правки — в двух местах: в `db/schema.sql` (для свежих
  установок) и отдельным идемпотентным файлом в `db/migrations/` для догона
  боевой БД. Применение: `docker compose exec db psql -U mybudget -d mybudget`
  и вставить содержимое файла; неинтерактивно из пайпа — только с `-T`:
  `docker compose exec -T db psql -U mybudget -d mybudget -f - < db/migrations/<file>.sql`
  (без `-T` compose отказывается принимать stdin: "cannot attach stdin to a
  TTY-enabled container").
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
npm ci               # установить зависимости по lock-файлу при необходимости
npm run dev          # запуск с HMR (nodemon + tsx)
npm run build        # компиляция в dist/
npm run start        # запуск из dist/
npm run lint         # проверка ESLint
npm run format       # форматирование Prettier
npm run typecheck    # проверка типов без компиляции
# публикация/проверка юридических документов (см. «Легальные документы и согласия»)
npm run legal:publish -- --all --dry-run   # проверка текстов + диффа с БД без записи
npm run legal:publish -- --all             # публикация всех файлов docs/legal/
npm run legal:publish -- --type privacy_policy --file docs/legal/privacy_policy.md
npm run legal:verify  # сверка content_hash с фактическим sha256 ВСЕХ типов (инциденты целостности)
```

После изменения кода: `npm run lint → npm run typecheck`. Для изменений только документации эти проверки не нужны. Автоматических тестов и команды `test` пока нет.

## Структура проекта

```
src/
  index.ts                     — точка входа
  app.ts                       — Express-приложение (middleware, монтирование /api/v1)
  router.ts                    — корневой роутер API (подключает роутеры модулей)
  middlewares/                 — authenticate, requireAdmin, requireConsent,
                                 rate-limit, error/notFound, requestLogging (логи в БД)
  scripts/                     — publish-legal-document.ts (CLI публикации документов,
                                 собирается в dist/scripts)
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
- **Логирование запросов:** `requestLoggingMiddleware` → `public.request_logs`.
  Не сохраняйте тела запросов/ответов, query, User-Agent и IP; сегменты идентификаторов
  в пути маскируются. GET-запросы админки не логируются, её мутации сохраняются для аудита.
  При изменении логирования или метрик читайте [справочник](docs/request-logging.md).
- **Formatting:** single quotes, semicolons, 2-space indent, trailing commas, 100-char width
- **Точка входа:** `src/index.ts` загружает dotenv и стартует сервер
- **Конфигурация:** `.env` файл (не `.env.example`); ключи: `PORT`, `CORS_ORIGIN`,
  `JWT_SECRET`, `DATABASE_URL`, `LOG_RETENTION_DAYS`, `CONSENT_ENC_KEY`
  (шифрование ip/ua в consent_log; без него регистрация/принятие согласия = 500;
  в прод-`.env` засевается job'ой `deploy-api` из переменной GitLab)

## Легальные документы и согласия

- Канон опубликованных текстов — БД; исходники — `docs/legal/`. Публикация только через
  `legal:publish`, сначала `--dry-run`; опубликованные версии напрямую не редактируются.
  Для косметических правок — `--cosmetic` с фиксацией факта в коммите.
- `privacy_policy` гейтит доступ, `terms_of_use` — информационный. Реестры типов сервера
  (`KNOWN_DOCUMENT_TYPES`) и клиента (`client/src/shared/legal/documents.ts`) должны совпадать.
- `consent_log` — append-only; удаление аккаунта — обезличивание с сохранением журнала.
  IP/UA шифруются ключом `CONSENT_ENC_KEY`; существующий ключ не перезаписывайте.
- Регистрация и запись согласия выполняются в одной транзакции. `requireConsent`
  защищает бизнес-модули; /auth, /users и /consent доступны для принятия и удаления аккаунта.
- При изменении согласий, регистрации, удаления аккаунта или публикации документов
  читайте [механизм и порядок деплоя](docs/consent-and-legal.md).

## Безопасность

- **Rate-limit'ы:** глобальный 1000 req/мин на IP (`rateLimitMiddleware`);
  ужесточённый 5 попыток / 15 мин на IP (`authRateLimitMiddleware`) висит на
  всех четырёх write-эндпоинтах auth: login, register, refresh, logout.
- **Блокировка аккаунта (второй слой к per-IP):** 5 неудачных входов подряд
  на аккаунт → вход запрещён на 15 минут; состояние в БД
  (`users.failed_login_attempts`, `users.locked_until`, см.
  `db/migrations/2026-09-11-login-lockout.sql`), инкремент — атомарный UPDATE
  в `authRepository.registerFailedAttempts`, сброс при успешном входе и смене
  пароля. 429 «Слишком много неудачных попыток входа...».
- **Пароли:** bcrypt(10), длина 8+ для регистрации и смены; вход принимает и
  legacy-пароли от 6 символов (`LEGACY_LOGIN_MIN_LENGTH`) — существующие аккаунты
  не должны терять доступ.
- **Refresh-токены:** одноразовые с ротацией. Повторная подача уже повёрнутого
  (отозванного) токена = вероятная кража → отзыв ВСЕХ сессий пользователя +
  `console.warn` с user_id (см. `authService.refresh`), наружу — общий 401.
  Отозванные/истёкшие строки чистятся вероятностно (~1/200 из createSession,
  запас хранения 30 дней). В `refresh_tokens` пишем только `user_agent` (атрибутика
  устройства); IP-адрес сессий не сохраняем (см. `db/migrations/2026-09-12-drop-ip-columns.sql`).
  Единственное место, где адрес пишется, — зашифрованный `consent_log`
  (юридически значимое согласие, см. «Легальные документы и согласия»).
- **Ошибки:** в `errorMiddleware` клиенту отдаётся текст только у `AppError` с 4xx;
  `AppError` с 5xx и прочие ошибки (включая сбои pg) → «Внутренняя ошибка сервера»
  (500), а настоящее сообщение (со стеком и pg-деталями) — в stderr через
  `src/shared/logger.ts` (`logServerError`) и в `request_logs.error`
  (проброс через `res.locals.serverError`). Ошибки парсинга тела → русские 400/413.
- **CORS:** `cors({ origin: process.env.CORS_ORIGIN })` без дефолта `'*'`.
  Прод same-origin (nginx проксирует `/api/`), переменную задавать точным
  origin ('https://домен') только при переезде клиента на отдельный домен.
- **`trust proxy: 2`** (app.ts) завязан на точную топологию из ДВА обратных
  прокси (хостовый nginx → nginx web-контейнера). При изменении числа прокси
  менять и это число, иначе `req.ip` (а с ним per-IP лимиты) станет
  подделываемым через X-Forwarded-For. Из `req.ip` больше ничего не строим;
  IP убран из логов и из refresh_tokens — исключение составляет только
  зашифрованный `consent_log` (там адрес — доказательство события согласия).
  Число trust proxy влияет и на него: неверное число = подделываемый IP в
  юридическом журнале.

## Типичная ошибка

- Не забывать `.js` расширение в импортах (ESM требует явного расширения)
- `console.log` вызывает ESLint-warn — использовать `console.error` или `console.warn` для логирования
