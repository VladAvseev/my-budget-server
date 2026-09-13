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
  `pgdata`; дальнейшие правки — двумя коммитами: в `db/schema.sql` (для свежих
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
npm install          # установить зависимости
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

Порядок проверки перед коммитом: `lint → typecheck → test`

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
- **Логирование запросов:** `requestLoggingMiddleware` пишет каждый HTTP-запрос
  в таблицу `public.request_logs` (схема — `db/schema.sql`): дата/время, метод,
  путь, статус, длительность, текст ошибки, user_id/user_role/is_authenticated.
  Автор — из
  `req.user`, который заполняет `authenticate`; пишется в `res.on('finish')`,
  поэтому к этому моменту уже известен статус. `user_role` — роль автора из
  JWT-claim на момент запроса ('user' | 'admin', null для неавторизованных):
  фиксируется именно тогда, т.к. роль в `users` со временем может измениться.
  `is_authenticated` фиксирует факт
  авторизации на момент запроса и отличается от `user_id is null` (после
  `on delete set null` строки удалённого юзера остались бы «без авторизации»).
  Тела запроса и ответа, query, User-Agent и IP в базу НЕ пишутся — они занимали
  основной объём таблицы и светили данные; текст ошибки извлекается на лету из
  envelope `{ error: { message } }` и сохраняется только для статусов >= 400
  (обрезается до 512 символов). UUID- и числовые сегменты пути пишутся как `:id`
  (`/api/v1/reports/:id`) — иначе метрики топов группировали бы каждый id
  отдельно; GET'ы админ-панели (`/api/v1/admin/*`) не логируются (опросы
  дашбордов заглушили бы таблицу), но не-GET админ-мутации логируются как
  audit trail (user_id, роль); публичного `/health` в API больше нет;
  вставка fire-and-forget. Env:
  `LOG_RETENTION_DAYS` (по умолчанию 30, устаревшие
  строки middleware удаляет сам, вероятностно ~1 раз на 200 запросов).
  Просмотр/метрики — `GET /admin/logs` (фильтры `status`, `userId=<uuid>` или
  `userId=anonymous` — только запросы без авторизации, `methods=GET,POST` —
  список HTTP-методов через запятую, пусто — все; сортировка
  `sort=date|duration` + `order=asc|desc`, по умолчанию свежие сверху),
  `GET /admin/logs/metrics`
  (вкладка «Логи» админ-панели клиента; логин автора тянется `LEFT JOIN users`;
  строка с ошибкой раскрывается по клику и показывает текст ошибки).
  График динамики логов —
  `GET /admin/logs/dynamics?audience=all|users&metric=count|unique_users&bucket=hour|day`:
  считает логи по МСК-часам или МСК-суткам (`date_trunc(..., created_at AT TIME ZONE
  'Europe/Moscow')`), аудитория `users` фильтрует по `user_role = 'user'`
  (без админов и без неавторизованных); метрика `unique_users` считает
  `count(distinct user_id)` на выбранном бакете, поэтому клиент не агрегирует
  часы в сутки суммированием.
  Тот же набор фильтров/метрик есть у
  `GET /admin/dashboard/operations-dynamics`
  (для `users` операции фильтруются JOIN'ом `users.role = 'user'` по
  `operations.user_id`, `aggregation=D|M|Y`). `user_role` в существующих строках проставлена
  идемпотентной миграцией `db/migrations/2026-09-11-request-logs-user-role.sql`
  через `user_id → users.role` (у неавторизованных и удалённых авторов роль
  остаётся NULL — восстановить по почте нельзя, она в логах не хранилась).
- **Formatting:** single quotes, semicolons, 2-space indent, trailing commas, 100-char width
- **Точка входа:** `src/index.ts` загружает dotenv и стартует сервер
- **Конфигурация:** `.env` файл (не `.env.example`); ключи: `PORT`, `CORS_ORIGIN`,
  `JWT_SECRET`, `DATABASE_URL`, `LOG_RETENTION_DAYS`, `CONSENT_ENC_KEY`
  (шифрование ip/ua в consent_log; без него регистрация/принятие согласия = 500;
  в прод-`.env` засевается job'ой `deploy-api` из переменной GitLab)

## Легальные документы и согласия (152-ФЗ + 99-З РБ)

Реализация требований `PersonalData.md` (миграция
`db/migrations/2026-09-12-consent-legal-documents.sql`).

- **`legal_documents`** — версионируемые тексты (Markdown в `content`,
  `content_hash` = sha256; HTML не хранится и не рендерится на сервере —
  клиент использует react-markdown). Ровно одна `is_current` на тип
  (частичный unique-индекс). Строка опубликованной версии не редактируется;
  косметическая правка — только `legal:publish --cosmetic` с фиксацией факта
  в коммите. `_legal` — только публичное чтение:
  `GET /legal/:documentType/current` и `/:documentType/:version`
  (без авторизации; ответ с сильным ETag=hash; при расхождении хэша с
  содержимым — console.warn «ИНЦИДЕНТ ЦЕЛОСТНОСТИ», текст всё равно отдаётся).
- **Типы документов** — `KNOWN_DOCUMENT_TYPES` (`_legal/types.ts`): два
  документа — `privacy_policy` (гейтит consent-gate: её принятие считается
  согласием на обработку ПДн, константа `_consent/GATING_DOCUMENT_TYPE`) и
  `terms_of_use` (информационный — публикации НЕ инвалидируют согласия).
  Ссылки/заголовки в
  UI и slug'ы — в реестре клиента `client/src/shared/legal/documents.ts`
  (зеркало); новый тип требует правки обоих реестров, иначе CLI его
  отклоняет (`--allow-unknown` — только для служебных вне UI).
- **Публикация** — только CLI `src/scripts/publish-legal-document.ts`. Исходник
  текста хранится в git: `server/docs/legal/<document_type>.md` (PersonalData.md
  п.2 пересмотрен 2026-09-12: файл — вход CLI, канон опубликованного текста —
  БД). В проде каталог примонтирован в api-контейнер (`./docs/legal:/docs:ro`,
  см. docker-compose.yml), публикация после deploy-api одной командой
  (`--all` берёт все файлы каталога, `--docs-dir`/`LEGAL_DOCS_DIR` меняет его,
  `--dry-run` и префлайт raw-HTML/плейсхолдеров — до любой записи):
  `docker compose exec api node dist/scripts/publish-legal-document.js --all --docs-dir /docs --dry-run`,
  затем без `--dry-run` (dev: `npm run legal:publish -- --all`).
  merge в develop ≠ опубликовано; идентичный текущему текст скрипт отказывается
  публиковать (защита от холостой инвалидации согласий). Версия = дата по МСК,
  конфликт дня → суффикс -2. Косметическая правка — `--cosmetic` с фиксацией
   факта в коммите. Порядок деплоя новой фичи: миграция → deploy api
   (засевает `CONSENT_ENC_KEY` в `.env` из переменной GitLab) → публикация v1 →
   deploy web. Первый пуск
  в проде: `terms_of_use` можно раньше, `privacy_policy` (гейтящая) —
  последним, web со ссылками деплоится уже после публикации.
- **`consent_log`** — append-only журнал (только INSERT с сервера;
  `created_at` — DEFAULT now()). `form_id`: registration | consent_gate |
  account_settings | admin; `action`: granted | revoked | erased. Композитный
  FK на (document_type, version) — версия обязана существовать. `user_id` —
  FK БЕЗ каскада: журнал обязан пережить пользователя (>= 3 года), поэтому
  physical delete аккаунта на уровне БД невозможен; вместо него — обезличивание
  (`consentService.revokeAndErase`: revoked → удаление финансовых данных +
  сессий, логин 'deleted-<uuid>' + недостижимый пароль → erased). Тот же
  сценарий обслуживает `DELETE /users/me` (самоудаление) и
  `DELETE /admin/users/:userId` (админ; в списках/статистике админки строки
  'deleted-<uuid>' скрыты константой `NOT_ANONYMIZED_SQL`).
- **ip/ua в журнале шифрованы** pgcrypto (`pgp_sym_encrypt`, armor), ключ —
  env `CONSENT_ENC_KEY` (без него запись согласия = 500). Это сознательное
  исключение из политики «IP не храним»: здесь адрес — доказательство
  юридически значимого события. Расшифровка только руками (SQL-запрос в
  шапке миграции). `request_logs` и `refresh_tokens` по-прежнему без IP.
- **Consent-gate (п.5):** логика `check_consent()` — в `_consent/service.ts`
  (нет записи / revoked / несовпадение с текущей версией → needsConsent;
  неопубликованный документ гейт НЕ включает). Эндпоинты: `GET
  /consent/status`, `POST /consent/grant` (версию сервер берёт сам),
  `POST /consent/revoke`. `requireConsent` висит на бизнес-модулях
  (operations/reports/categories/accumulations/goals/admin) и отдаёт 403 с
  `error.code='CONSENT_REQUIRED'` (поле кода добавлено в envelope
  errorMiddleware — обратно совместимо); /auth, /users и /consent доступны и
  в состоянии NEEDS_CONSENT (путь к принятию и удалению аккаунта). Состояние
  кэшируется в памяти процесса на 60 c (по образцу touchLastActive);
  мутации согласия сбрасывают кэш, публикация из CLI — по истечении TTL.
  `ConsentStateDto` кроме `currentVersion` отдаёт `grantedVersion` — версию
  последней `granted`-записи журнала (профиль показывает её ссылкой на
  исторический текст; после отзыва latest — revoked/erased, но grantedVersion
  остаётся).
- **Регистрация (п.4):** тело `POST /auth/register` обязано содержать
  `consent: true` (400 + code CONSENT_REQUIRED иначе); строка users и
  первая запись журнала пишутся в одной транзакции (`withTransaction`).

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
- **Ошибки:** в `errorMiddleware` клиенту отдаётся текст только у `AppError`;
  прочие ошибки (включая сбои pg) → «Внутренняя ошибка сервера» (500), детали
  — только в stderr. Ошибки парсинга тела → русские 400/413.
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
