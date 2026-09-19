import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL не задан (см. .env)');
}

const needsSsl = /([?&])sslmode=require/i.test(connectionString);

pg.types.setTypeParser(pg.types.builtins.DATE, (value: string) => value);

export const pool = new Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
});

pool.on('error', (err) => {

  process.stderr.write(`Неожидаемая ошибка пула PostgreSQL: ${err.message}\n`);
});

export async function checkDbConnection(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch (err) {
    process.stderr.write(`Проверка соединения с PostgreSQL не прошла: ${(err as Error).message}\n`);
    return false;
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
