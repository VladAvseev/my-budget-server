#!/usr/bin/env node
/**
 * Миграция данных my-budget: Supabase (старый прод) -> PostgreSQL 16 сервера.
 *
 * Что переносится:
 *   auth.users + public.profiles  ->  public.users (одной таблицей; bcrypt-хэш
 *                                     пароля GoTrue переезжает как есть,
 *                                     пользователи входят прежним паролем);
 *   public.reports/categories/operations/accumulations/goals/category_limits ->
 *     одноимённые таблицы новой схемы (db/schema.sql).
 *
 * Особенности источника, которые обработаны:
 *   * operations.date и reports.period_* в Supabase хранились как text —
 *     нормализуются в 'YYYY-MM-DD' (невалидное -> null, с предупреждением);
 *   *Goals.target_date появилась поздним ALTER и может отсутствовать;
 *   * непустой code отчёта уникален в рамках пользователя только частичным
 *     индексом новой схемы — дубликаты (кроме первого по created_at)
 *     обнуляются, сервер при create_report проверяет код сам;
 *   * сироты (user_id без auth.users) отбрасываются.
 *
 * Запуск:
 *   dry-run (ничего не пишет):
 *     node db/migrate-from-supabase.mjs --dry-run
 *   боевой перенос (сначала TRUNCATE целевых таблиц, затем загрузка в одной
 *   транзакции; повторный запуск = полная перезагрузка — идемпотентно):
 *     node db/migrate-from-supabase.mjs --yes
 *
 * Переменные окружения (.env рядом с docker-compose или в окружении):
 *   SUPABASE_DB_URL — прямое PG-подключение к базе Supabase
 *                     (Dashboard -> Settings -> Database -> Connection string,
 *                     Session pooler, порт 5432; пароль — Database password);
 *   DATABASE_URL    — целевая база (на сервере: postgres://mybudget:...@db:5432/mybudget).
 *
 * На сервере (контейнер api уже содержит driver `pg` и prod-зависимости):
 *   cd /opt/mybudget/server
 *   docker compose run --rm --no-deps \
 *     -v "$PWD/db:/migrations" \
 *     -e SUPABASE_DB_URL='postgres://postgres.<ref>:<pass>@aws-...:5432/postgres?sslmode=require' \
 *     --entrypoint node api /migrations/migrate-from-supabase.mjs --dry-run
 *   # если отчёт устроил — повторить с --yes
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

const SRC_URL = process.env.SUPABASE_DB_URL;
const DST_URL = process.env.DATABASE_URL;
if (!SRC_URL || !DST_URL) {
  console.error('Нужны обе переменные: SUPABASE_DB_URL (источник) и DATABASE_URL (цель)');
  process.exit(1);
}

/** Supabase/pooler требует sslmode=require — транслируем его в опцию ssl. */
const sslOf = (url) => (/([?&])sslmode=require/i.test(url) ? { rejectUnauthorized: false } : undefined);

const src = new Client({ connectionString: SRC_URL, ssl: sslOf(SRC_URL) });
const dst = new Client({ connectionString: DST_URL, ssl: sslOf(DST_URL) });

const warnings = [];
const log = console.log;

/** 'YYYY-MM-DD' из text-наследия Supabase; мусор -> null (плюс учёт в warnings). */
function toIsoDate(value, label) {
  if (value === null || value === undefined || value === '') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (!m) {
    warnings.push(`${label}: не разобрана дата «${String(value).slice(0, 20)}» -> null`);
    return null;
  }
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) {
    warnings.push(`${label}: невозможная дата «${m[0]}» -> null`);
    return null;
  }
  return m[0];
}

async function tableColumns(client, table, schema = 'public') {
  const { rows } = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2`,
    [schema, table],
  );
  return new Set(rows.map((r) => r.column_name));
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

// ── источник ────────────────────────────────────────────────────────────────

await src.connect();
await dst.connect();

log(`Источник: таблицы Supabase; цель: ${DST_URL.replace(/:[^:@/]*@/, ':***@')}`);

const srcCols = {};
for (const table of ['profiles', 'reports', 'categories', 'operations', 'accumulations', 'goals', 'category_limits']) {
  srcCols[table] = await tableColumns(src, table);
}
if (!srcCols.profiles) {
  throw new Error('В источнике нет public.profiles — остановка');
}

const authUsers = (await src.query(
  'SELECT id, email, encrypted_password, created_at, updated_at FROM auth.users',
)).rows;
const profiles = (await src.query('SELECT * FROM public.profiles')).rows;

const profileByUser = new Map(profiles.map((p) => [String(p.user_id), p]));
const userIds = new Set(authUsers.map((u) => String(u.id)));

// ── users: auth.users + profiles -> одна таблица новой схемы ────────────────

// bcrypt GoTrue отдаёт хэши $2a$/$2b$/$2y$ — наш bcryptjs сверяет все эти
// варианты, поэтому пароли переезжают как есть. Прочее (редкий scrypt/пусто)
// — подстановочный хэш: такой пользователь получит «Неверный email или пароль»
// и попадёт в список на сброс.
const FALLBACK_HASH = bcrypt.hashSync(crypto.randomBytes(32).toString('base64'), 10);
const needsPasswordReset = [];

const userRows = authUsers.map((u) => {
  const p = profileByUser.get(String(u.id)) ?? {};
  const role = p.role === 'admin' ? 'admin' : 'user';
  let hash = String(u.encrypted_password ?? '');
  if (!/^\$2[aby]\$/.test(hash)) {
    needsPasswordReset.push(u.email);
    hash = FALLBACK_HASH;
  }
  return {
    id: u.id,
    email: u.email,
    password_hash: hash,
    role,
    start_balance: p.start_balance ?? '0',
    currency: p.currency ?? null,
    onboarded: Boolean(p.onboarded),
    last_active_at: p.last_active_at ?? null,
    created_at: p.created_at ?? u.created_at,
    updated_at: p.updated_at ?? u.updated_at,
  };
});

// ── бизнес-таблицы: прогон через нормализацию и фильтр сирот ────────────────

const [srcReports, srcCategories, srcOperations, srcAccumulations, srcGoals, srcLimits] =
  await Promise.all([
    src.query('SELECT * FROM public.reports').then((r) => r.rows),
    src.query('SELECT * FROM public.categories').then((r) => r.rows),
    src.query('SELECT * FROM public.operations').then((r) => r.rows),
    src.query('SELECT * FROM public.accumulations').then((r) => r.rows),
    src.query('SELECT * FROM public.goals').then((r) => r.rows),
    src.query('SELECT * FROM public.category_limits').then((r) => r.rows),
  ]);

const own = (rows) => rows.filter((r) => userIds.has(String(r.user_id)));

const categoryIds = new Set(own(srcCategories).map((c) => String(c.id)));
const goalHasTargetDate = srcCols.goals.has('target_date');

const reports = own(srcReports).map((r) => ({
  ...r,
  code: r.code ?? '',
  period_start: toIsoDate(r.period_start, `reports.${r.id}.period_start`),
  period_end: toIsoDate(r.period_end, `reports.${r.id}.period_end`),
}));

// дедуп code: partial unique индекс (user_id, code where code <> '') — оставляем
// первую по created_at запись с кодом, у остальных код обнуляем.
{
  const seen = new Set();
  const sorted = [...reports].sort(
    (a, b) => new Date(a.created_at) - new Date(b.created_at) || 0,
  );
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

// category_id мог указывать на удалённую категорию (в источнике FK мягкие) —
// в новой схеме это реальный FK, поэтому несуществующие ссылки обнуляем.
const safeCategory = (id, label) => {
  if (id === null || id === undefined) return null;
  if (categoryIds.has(String(id))) return id;
  warnings.push(`${label}: категория ${id} отсутствует — ссылка снята`);
  return null;
};

const operations = own(srcOperations).map((o) => ({
  ...o,
  date: toIsoDate(o.date, `operations.${o.id}.date`),
  category_id: safeCategory(o.category_id, `operations.${o.id}`),
}));

const accumulations = own(srcAccumulations).map((a) => ({
  ...a,
  category_id: safeCategory(a.category_id, `accumulations.${a.id}`),
}));

const ownGoals = own(srcGoals);
const goalsWithCategory = ownGoals.filter((g) => {
  const ok = categoryIds.has(String(g.category_id));
  if (!ok) warnings.push(`goals.${g.id}: категория ${g.category_id} отсутствует — строка пропущена`);
  return ok;
});
const goals = goalsWithCategory
  .filter((g) => {
    if (Number(g.amount) > 0) return true;
    warnings.push(`goals.${g.id}: amount <= 0 — пропущен (CHECK новой схемы)`);
    return false;
  })
  .map((g) => ({
    ...g,
    target_date: goalHasTargetDate ? toIsoDate(g.target_date, `goals.${g.id}.target_date`) : null,
  }));

const reportIdSet = new Set(reports.map((r) => String(r.id)));
const categoryLimits = own(srcLimits).filter(
  (l) => categoryIds.has(String(l.category_id)) && reportIdSet.has(String(l.report_id)),
);

// ── запись ──────────────────────────────────────────────────────────────────

log('\nПлан переноса:');
for (const [name, rows] of [
  ['users', userRows],
  ['reports', reports],
  ['categories', own(srcCategories)],
  ['operations', operations],
  ['accumulations', accumulations],
  ['goals', goals],
  ['category_limits', categoryLimits],
]) {
  log(`  ${name}: ${rows.length}`);
}
if (needsPasswordReset.length) {
  log(`  ⚠ пароли не-bcrypt (потребуется сброс): ${needsPasswordReset.join(', ')}`);
}

if (DRY_RUN) {
  log('\n--dry-run: в цель ничего не записано.');
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
      ['id','user_id','type','name','color','created_at','updated_at'], own(srcCategories));
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

    // ── сверка на месте (ошибки откатят транзакцию целиком) ─────────────────
    const counts = await dst.query(
      `SELECT
        (SELECT count(*) FROM public.users)          AS users,
        (SELECT count(*) FROM public.categories)     AS categories,
        (SELECT count(*) FROM public.reports)        AS reports,
        (SELECT count(*) FROM public.operations)     AS operations,
        (SELECT count(*) FROM public.accumulations)  AS accumulations,
        (SELECT count(*) FROM public.goals)          AS goals,
        (SELECT count(*) FROM public.category_limits) AS category_limits`,
    );
    const c = counts.rows[0];
    const plan = {
      users: userRows.length,
      categories: own(srcCategories).length,
      reports: reports.length,
      operations: operations.length,
      accumulations: accumulations.length,
      goals: goals.length,
      category_limits: categoryLimits.length,
    };
    let mismatch = false;
    for (const key of Object.keys(plan)) {
      if (Number(c[key]) !== plan[key]) {
        mismatch = true;
        warnings.push(`СВЕРКА: ${key} планировалось ${plan[key]}, записано ${c[key]}`);
      }
    }
    if (mismatch) throw new Error('Расхождение счётчиков после вставки — откат');

    await dst.query('COMMIT');
    log('\nПеренос закоммичен ✅');
  } catch (error) {
    await dst.query('ROLLBACK');
    console.error('\nОткатано:', error.message);
    process.exitCode = 1;
  }
}

// ── отчёт сверки по суммам (общий, независимо от записи) ────────────────────

function sumByType(rows) {
  const acc = {};
  for (const o of rows) acc[o.type] = (acc[o.type] ?? 0) + Number(o.amount);
  return acc;
}
const srcSums = sumByType(operations);
log('\nСуммы operations по типам (источник -> план цели):');
for (const type of Object.keys(srcSums)) {
  log(`  ${type}: ${srcSums[type].toFixed(2)}`);
}

if (warnings.length) {
  log('\nПредупреждения:');
  for (const w of warnings) log(`  - ${w}`);
}

await src.end();
await dst.end();
