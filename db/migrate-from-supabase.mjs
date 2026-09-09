#!/usr/bin/env node
/**
 * Миграция данных my-budget: Supabase -> PostgreSQL сервера, ЧЕРЕЗ API.
 *
 * Источник — не прямое PG-подключение (оно требует пулер/allowlist и отдает
 * IPv6, недоступный VPS), а публичные эндпоинты Supabase:
 *   * PostgREST (`/rest/v1/<таблица>`) — бизнес-данные, с постраничной
 *     выборкой по заголовку Range (PostgREST по умолчанию режет выдачу
 *     1000 строк — тот самый лимит, из-за которого admin-график истории
 *     операций когда-то группировался на стороне БД);
 *   * GoTrue Admin API (`/auth/v1/admin/users`) — список аккаунтов.
 * Нужен SECRET-ключ (sb_secret_.../service_role): он обходит RLS, анонимный
 * publishable-ключ через политики `auth.uid() = user_id` вернул бы пустые
 * таблицы.
 *
 * Ограничение API: хэши паролей GoTrue наружу не отдаёт, поэтому каждому
 * пользователю генерируется ВРЕМЕННЫЙ пароль; в конце --yes печатает список
 * `email — пароль` для ручной раздачи. Сменив пароль в профиле, пользователь
 * вернёт себе постоянный.
 *
 * Что переносится:
 *   auth.users + public.profiles  ->  public.users (роль, стартовый баланс,
 *                                     валюта, онбординг, активность);
 *   reports/categories/operations/accumulations/goals/category_limits ->
 *     одноимённые таблицы новой схемы (db/schema.sql).
 *
 * Нормализации источника (исторические особенности Supabase):
 *   * operations.date и reports.period_* хранились как text -> 'YYYY-MM-DD'
 *     (невалидное -> null с предупреждением);
 *   * goals.target_date появилась поздним ALTER и у части строк может
 *     отсутствовать (REST просто не вернёт поле);
 *   * code отчёта: в новой схеме partial-unique в рамках пользователя —
 *     дубликаты (кроме первого по created_at) обнуляются;
 *   * ссылки на удалённые категории/отчёты снимались RLS-каскадами в
 *     источнике, но сироты отфильтрованы и здесь; goals с amount <= 0
 *     отбрасываются (CHECK новой схемы).
 *
 * Запуск на сервере (пароль БД больше не нужен):
 *   cd /opt/mybudget/server && git pull
 *   docker compose run --rm --no-deps \
 *     -e SUPABASE_URL='https://<ref>.supabase.co' \
 *     -e SUPABASE_SERVICE_ROLE_KEY='<sb_secret...>' \
 *     api node db/migrate-from-supabase.mjs --dry-run
 *   # сверить отчёт — затем --yes
 *
 * Флаги:
 *   --dry-run  прочитать источник, напечатать план и предупреждения, НЕ писать;
 *   --yes      TRUNCATE целевых таблиц и полная загрузка в одной транзакции
 *              (повтор = идемпотентная перезагрузка).
 */

import 'dotenv/config';
import crypto from 'node:crypto';
import { Client } from 'pg';
import bcrypt from 'bcryptjs';

const ARGS = new Set(process.argv.slice(2));
const DRY_RUN = ARGS.has('--dry-run');
const CONFIRMED = ARGS.has('--yes');

if (!DRY_RUN && !CONFIRMED) {
  console.error('Использование: node migrate-from-supabase.mjs --dry-run | --yes');
  process.exit(1);
}

const SRC = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DST_URL = process.env.DATABASE_URL;
if (!SRC || !KEY || !DST_URL) {
  console.error('Нужны переменные: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL');
  process.exit(1);
}

const PAGE = 1000; // PostgREST по умолчанию отдаёт не больше 1000 строк
const AUTH_PAGE = 500;

const warnings = [];
const log = console.log;

// ── чтение источника через HTTP API ─────────────────────────────────────────

async function restGet(url) {
  const res = await fetch(url, {
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Supabase API ${res.status} ${url}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

/** Одна таблица PostgREST целиком, страницами по PAGE строк.
 *  Порядок — по первичному ключу (у большинства это id, у profiles — user_id),
 *  иначе постраничная выборка нестабильна. */
async function restAll(table, orderColumn = 'id') {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const rows = await restGet(
      `${SRC}/rest/v1/${table}?select=*&order=${orderColumn}.asc&offset=${from}&limit=${PAGE}`,
    );
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/** Список аккаунтов GoTrue админ-страницами; next_page отсутствует на последней. */
async function adminUsers() {
  const users = [];
  for (let page = 1; ; page += 1) {
    const body = await restGet(`${SRC}/auth/v1/admin/users?page=${page}&per_page=${AUTH_PAGE}`);
    users.push(...(body.users ?? []));
    if (!body.next_page) break;
  }
  return users;
}

// ── запись в целевую PostgreSQL ─────────────────────────────────────────────

const dst = new Client({
  connectionString: DST_URL,
  ssl: /([?&])sslmode=require/i.test(DST_URL) ? { rejectUnauthorized: false } : undefined,
});

/** 'YYYY-MM-DD' из text-наследия Supabase; мусор -> null (плюс warning). */
function toIsoDate(value, label) {
  if (value === null || value === undefined || value === '') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (!m) {
    warnings.push(`${label}: не разобрана дата «${String(value).slice(0, 20)}» -> null`);
    return null;
  }
  const d = new Date(`${m[0]}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) {
    warnings.push(`${label}: невозможная дата «${m[0]}» -> null`);
    return null;
  }
  return m[0];
}

/** Пакетная вставка с whitelisted именами колонок (значения — только параметрами). */
async function insertRows(client, table, columns, rows) {
  const CHUNK = 400;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const params = [];
    const tuples = chunk
      .map((row) => {
        const marks = columns.map((col) => {
          params.push(row[col]);
          return `$${params.length}`;
        });
        return `(${marks.join(', ')})`;
      })
      .join(', ');
    await client.query(
      `INSERT INTO public.${table} (${columns.join(', ')}) VALUES ${tuples}`,
      params,
    );
  }
  return rows.length;
}

// ── основной поток ──────────────────────────────────────────────────────────

await dst.connect();
log(`Источник API: ${SRC}`);
log(`Цель: ${DST_URL.replace(/:[^:@/]*@/, ':***@')}`);

const [authUsersRaw, profiles, srcReports, srcCategories, srcOperations, srcAccumulations, srcGoals, srcLimits] =
  await Promise.all([
    adminUsers(),
    restAll('profiles', 'user_id'),
    restAll('reports'),
    restAll('categories'),
    restAll('operations'),
    restAll('accumulations'),
    restAll('goals'),
    restAll('category_limits'),
  ]);

const profileByUser = new Map(profiles.map((p) => [String(p.user_id), p]));

// ── users: auth.users + profiles -> одна таблица новой схемы ────────────────

// Временные пароли: хэш в GoTrue API скрыт (json:"-"), поэтому каждый
// аккаунт получает свежий криптостойкий пароль; список печатается в конце.
const tempPasswords = [];
const needsEmail = [];

const userRows = [];
for (const u of authUsersRaw) {
  if (!u.email) {
    needsEmail.push(u.id);
    continue;
  }
  const p = profileByUser.get(String(u.id)) ?? {};
  const temp = crypto.randomBytes(9).toString('base64url'); // 12 символов
  tempPasswords.push({ email: u.email, temp });
  userRows.push({
    id: u.id,
    email: u.email,
    password_hash: bcrypt.hashSync(temp, 10),
    role: p.role === 'admin' ? 'admin' : 'user',
    start_balance: p.start_balance ?? 0,
    currency: p.currency ?? null,
    onboarded: Boolean(p.onboarded),
    last_active_at: p.last_active_at ?? null,
    created_at: p.created_at ?? u.created_at,
    updated_at: p.updated_at ?? u.updated_at ?? u.created_at,
  });
}
if (needsEmail.length) {
  warnings.push(`auth.users: ${needsEmail.length} аккаунтов без email пропущено (id: ${needsEmail.join(', ')})`);
}

const userIds = new Set(userRows.map((u) => String(u.id)));
const own = (rows) => rows.filter((r) => userIds.has(String(r.user_id)));

// ── бизнес-таблицы: нормализация и фильтрация сирот ─────────────────────────

const categories = own(srcCategories);
const categoryIds = new Set(categories.map((c) => String(c.id)));

/** category_id мог смотреть на удалённую категорию — в новой схеме это FK. */
function safeCategory(id, label) {
  if (id === null || id === undefined) return null;
  if (categoryIds.has(String(id))) return id;
  warnings.push(`${label}: категория ${id} отсутствует — ссылка снята`);
  return null;
}

const reports = own(srcReports).map((r) => ({
  ...r,
  code: r.code ?? '',
  period_start: toIsoDate(r.period_start, `reports.${r.id}.period_start`),
  period_end: toIsoDate(r.period_end, `reports.${r.id}.period_end`),
}));

// дедуп code: partial unique индекс (user_id, code where code <> '') —
// оставляем первую по created_at запись с кодом, у остальных код обнуляем.
{
  const seen = new Set();
  const sorted = [...reports].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  for (const r of sorted) {
    if (!r.code) continue;
    const key = `${r.user_id}|${r.code}`;
    if (seen.has(key)) {
      warnings.push(`reports.${r.id}: дубликат кода «${r.code}» — код снят`);
      r.code = '';
    } else {
      seen.add(key);
    }
  }
}

const reportIdSet = new Set(reports.map((r) => String(r.id)));

const operations = own(srcOperations).map((o) => ({
  ...o,
  date: toIsoDate(o.date, `operations.${o.id}.date`),
  category_id: safeCategory(o.category_id, `operations.${o.id}`),
}));

const accumulations = own(srcAccumulations).map((a) => ({
  ...a,
  category_id: safeCategory(a.category_id, `accumulations.${a.id}`),
}));

const goals = own(srcGoals)
  .filter((g) => {
    const ok = categoryIds.has(String(g.category_id));
    if (!ok) warnings.push(`goals.${g.id}: категория ${g.category_id} отсутствует — строка пропущена`);
    return ok;
  })
  .filter((g) => {
    if (Number(g.amount) > 0) return true;
    warnings.push(`goals.${g.id}: amount <= 0 — пропущен (CHECK новой схемы)`);
    return false;
  })
  .map((g) => ({ ...g, target_date: toIsoDate(g.target_date, `goals.${g.id}.target_date`) }));

const categoryLimits = own(srcLimits).filter((l) => {
  const ok = categoryIds.has(String(l.category_id)) && reportIdSet.has(String(l.report_id));
  if (!ok) warnings.push(`category_limits.${l.id}: потерял отчёт или категорию — строка пропущена`);
  return ok;
});

// ── план / запись ───────────────────────────────────────────────────────────

const plan = {
  users: userRows,
  categories,
  reports,
  operations,
  accumulations,
  goals,
  category_limits: categoryLimits,
};

log('\nПлан переноса:');
for (const [name, rows] of Object.entries(plan)) log(`  ${name}: ${rows.length}`);
log(`  временные пароли: ${tempPasswords.length} шт.`);

const reportWarnings = () => {
  if (!warnings.length) return;
  log('\nПредупреждения:');
  for (const w of warnings) log(`  - ${w}`);
};

if (DRY_RUN) {
  log('\n--dry-run: в цель ничего не записано.');
  reportWarnings();
  await dst.end();
  process.exitCode = 0;
} else {
  try {
    await dst.query('BEGIN');
    await dst.query(
      `TRUNCATE public.refresh_tokens, public.users, public.reports, public.categories,
              public.operations, public.accumulations, public.goals, public.category_limits
       RESTART IDENTITY CASCADE`,
    );

    await insertRows(dst, 'users',
      ['id','email','password_hash','role','start_balance','currency','onboarded','last_active_at','created_at','updated_at'],
      userRows);
    await insertRows(dst, 'categories',
      ['id','user_id','type','name','color','created_at','updated_at'], categories);
    await insertRows(dst, 'reports',
      ['id','user_id','name','code','has_daily_expenses','daily_budget','period_start','period_end','created_at','updated_at'],
      reports);
    await insertRows(dst, 'operations',
      ['id','report_id','user_id','type','amount','category_id','description','date','created_at','updated_at'],
      operations);
    await insertRows(dst, 'accumulations',
      ['id','user_id','category_id','description','amount','created_at','updated_at'], accumulations);
    await insertRows(dst, 'goals',
      ['id','user_id','category_id','amount','target_date','created_at','updated_at'], goals);
    await insertRows(dst, 'category_limits',
      ['id','report_id','category_id','user_id','amount','created_at','updated_at'], categoryLimits);

    // Сверка счётчиков: расхождение откатывает всю транзакцию.
    const { rows } = await dst.query(
      `SELECT
        (SELECT count(*) FROM public.users)           AS users,
        (SELECT count(*) FROM public.categories)      AS categories,
        (SELECT count(*) FROM public.reports)         AS reports,
        (SELECT count(*) FROM public.operations)      AS operations,
        (SELECT count(*) FROM public.accumulations)   AS accumulations,
        (SELECT count(*) FROM public.goals)           AS goals,
        (SELECT count(*) FROM public.category_limits) AS category_limits`,
    );
    const c = rows[0];
    let mismatch = false;
    for (const key of Object.keys(plan)) {
      if (Number(c[key]) !== plan[key].length) {
        mismatch = true;
        warnings.push(`СВЕРКА: ${key} планировалось ${plan[key].length}, записано ${c[key]}`);
      }
    }
    if (mismatch) throw new Error('Расхождение счётчиков после вставки — откат');

    await dst.query('COMMIT');
    log('\nПеренос закоммичен ✅');

    // Контрольные суммы по типам операций: источник vs цель.
    const sumsSrc = {};
    for (const o of operations) sumsSrc[o.type] = (sumsSrc[o.type] ?? 0) + Number(o.amount);
    const { rows: dstSums } = await dst.query(
      'SELECT type, sum(amount) AS total FROM public.operations GROUP BY type',
    );
    log('\nКонтроль сумм operations (источник -> цель):');
    for (const type of Object.keys(sumsSrc)) {
      const row = dstSums.find((r) => r.type === type);
      log(`  ${type}: ${sumsSrc[type].toFixed(2)} -> ${(row ? Number(row.total) : 0).toFixed(2)}`);
    }

    log('\n════ ВРЕМЕННЫЕ ПАРОЛИ (раздать пользователям, затем уничтожить) ════');
    for (const p of tempPasswords) log(`  ${p.email} — ${p.temp}`);
    log('══════════════════════════════════════════════════════════════════════');
  } catch (error) {
    await dst.query('ROLLBACK');
    console.error('\nОткатано:', error.message);
    process.exitCode = 1;
  }
  reportWarnings();
  await dst.end();
}
