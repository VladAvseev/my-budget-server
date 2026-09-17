/** Только изолированная БД goals_check*: прод запрещён. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import express from 'express';
import { pool } from '../src/db/pool.js';
import { goalsController } from '../src/modules/_goals/controller.js';
import { accountsController } from '../src/modules/_accounts/controller.js';
import { errorMiddleware } from '../src/middlewares/errorMiddleware.js';

const url = new URL(process.env.DATABASE_URL!);
assert.ok(
  ['127.0.0.1', 'localhost'].includes(url.hostname) && /^\/goals_check\w*$/.test(url.pathname),
  'Нужна отдельная локальная база goals_check*',
);
const { rows: tables } = await pool.query(
  "SELECT tablename FROM pg_tables WHERE schemaname='public'",
);
assert.equal(tables.length, 0, 'Проверка запускается только на пустой тестовой базе');
await pool.query(readFileSync('db/schema.sql', 'utf8'));
console.warn('Пустая schema.sql: успешно');
const migration = readFileSync('db/migrations/2026-09-15-account-goals.sql', 'utf8');
// Старая таблица целей для проверки перехода.
await pool.query(
  'DROP TABLE public.goals; CREATE TABLE public.goals (id uuid, category_id uuid); INSERT INTO public.goals VALUES (gen_random_uuid(), gen_random_uuid())',
);
await pool.query(migration);
assert.equal((await pool.query('SELECT * FROM public.goals')).rowCount, 0);
const ids = (
  await pool.query(
    "INSERT INTO public.users (login,password) VALUES ('goals-owner','test'),('goals-other','test') RETURNING id",
  )
).rows.map((r) => r.id);
const owner = ids[0],
  other = ids[1];
const account = (
  await pool.query("INSERT INTO public.accounts (user_id,name) VALUES ($1,'Отпуск') RETURNING id", [
    owner,
  ])
).rows[0].id;
const foreign = (await pool.query('SELECT id FROM public.accounts WHERE user_id=$1', [other]))
  .rows[0].id;
const app = express();
app.use(express.json());
// Изолированный стенд: только тестовый владелец, реальные контроллеры и SQL.
app.use((req, _res, next) => {
  req.user = {
    id: req.headers.authorization === 'Bearer other' ? other : owner,
  } as typeof req.user;
  next();
});
for (const [resource, controller] of [
  ['goals', goalsController],
  ['accounts', accountsController],
] as const) {
  app.get(`/api/v1/${resource}`, controller.list);
  app.post(`/api/v1/${resource}`, controller.create);
  app.patch(`/api/v1/${resource}/:id`, controller.update);
  app.delete(`/api/v1/${resource}/:id`, controller.remove);
}
app.use(errorMiddleware);
const server = app.listen(5501, '127.0.0.1');
// Ответ стенда: json() типизирован как unknown, для проверок удобнее any.
type CheckResponse = { status: number; data: any; location: string | null };
const request = async (
  path: string,
  method = 'GET',
  body?: unknown,
  otherUser = false,
): Promise<CheckResponse> => {
  const res = await fetch(`http://127.0.0.1:5501/api/v1${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: otherUser ? 'Bearer other' : 'Bearer owner',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: res.status,
    data: res.status === 204 ? null : ((await res.json()) as any),
    location: res.headers.get('Location'),
  };
};
try {
  const created = await request('/goals', 'POST', {
    accountId: account,
    amount: 1000,
    targetDate: '2027-01-01',
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.data.account_id, account);
  assert.equal(typeof created.data.data.amount, 'number');
  const goalId = created.data.data.id;
  assert.equal(created.location, `/api/v1/goals/${goalId}`);
  await pool.query(migration);
  assert.equal((await pool.query('SELECT id FROM public.goals')).rows[0].id, goalId);
  assert.equal((await request('/goals', 'POST', { accountId: account, amount: 2000 })).status, 409);
  assert.equal((await request('/goals', 'POST', { accountId: foreign, amount: 2000 })).status, 404);
  assert.equal(
    (
      await request('/goals', 'POST', {
        accountId: '00000000-0000-0000-0000-000000000000',
        amount: 2000,
      })
    ).status,
    404,
  );
  assert.equal(
    (await request('/goals', 'POST', { categoryId: account, amount: 2000 })).status,
    400,
  );
  for (const date of ['2026-02-30', '2026-13-01', '0000-01-01'])
    assert.equal(
      (await request('/goals', 'POST', { accountId: account, amount: 2000, targetDate: date }))
        .status,
      400,
    );
  for (const amount of [0, -1, 'NaN', 'Infinity'])
    assert.equal((await request('/goals', 'POST', { accountId: account, amount })).status, 400);
  assert.equal(
    (await request(`/goals/${goalId}`, 'PATCH', { amount: 1200, targetDate: null })).data.data
      .target_date,
    null,
  );
  assert.equal((await request(`/goals/${goalId}`, 'PATCH', { amount: 1200 }, true)).status, 404);
  assert.equal((await request(`/goals/${goalId}`, 'DELETE', undefined, true)).status, 404);
  assert.equal((await request('/goals', 'GET', undefined, true)).data.data.length, 0);
  assert.equal((await request(`/accounts/${account}`, 'PATCH', { is_closed: true })).status, 200);
  assert.equal((await request('/goals')).data.data.length, 0);
  assert.equal((await request('/goals', 'POST', { accountId: account, amount: 2000 })).status, 400);
  assert.equal((await request(`/accounts/${account}`, 'PATCH', { is_closed: false })).status, 200);
  assert.equal((await request('/goals')).data.data.length, 1);
  assert.equal((await request(`/goals/${goalId}`, 'DELETE')).status, 204);
  const parallel = await Promise.all([
    request('/goals', 'POST', { accountId: account, amount: 1000 }),
    request('/goals', 'POST', { accountId: account, amount: 1000 }),
  ]);
  assert.deepEqual(parallel.map((r) => r.status).sort(), [201, 409]);
  for (const [sql, args, code] of [
    [
      'INSERT INTO public.goals (user_id,account_id,amount) VALUES ($1,$2,100)',
      [owner, account],
      '23505',
    ],
    ['INSERT INTO public.goals (user_id,amount) VALUES ($1,100)', [owner], '23502'],
    [
      "INSERT INTO public.goals (user_id,account_id,amount) VALUES ($1,$2,'NaN')",
      [owner, foreign],
      '23514',
    ],
    [
      "INSERT INTO public.goals (user_id,account_id,amount) VALUES ($1,$2,'Infinity')",
      [owner, foreign],
      '23514',
    ],
  ] as const)
    await assert.rejects(pool.query(sql, [...args]), (e: { code?: string }) => e.code === code);
  assert.equal((await request(`/accounts/${account}`, 'DELETE')).status, 204);
  assert.equal(
    (await pool.query('SELECT * FROM public.goals WHERE account_id=$1', [account])).rowCount,
    0,
  );
  console.warn(
    'Миграция повторно, UNIQUE/NOT NULL/конечная сумма, API CRUD/404/409/дубли/закрытие/открытие/каскад: успешно',
  );
} finally {
  server.close();
  await pool.end();
}
