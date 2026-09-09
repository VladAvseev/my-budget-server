import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL не задан (см. .env)');
}

// Supabase/pooler отдают строки с sslmode=require — включаем SSL только тогда,
// иначе локальный PostgreSQL без SSL не примет соединение.
const needsSsl = /([?&])sslmode=require/i.test(connectionString);

// Колонки типа `date` (OID 1082) драйвер по умолчанию парсит в JS Date на
// локальную полночь — при сериализации в ISO-строку день уезжает на сутки
// назад для таймзонов западнее UTC. Оставляем сырую строку 'YYYY-MM-DD':
// клиент и от Supabase получал даты именно строками (колонки были text/jsonb).
pg.types.setTypeParser(pg.types.builtins.DATE, (value: string) => value);

export const pool = new Pool({
  connectionString,
  max: 5, // небольшой пул: достаточно для ненагруженной системы
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
});

pool.on('error', (err) => {
  // Ошибка фонового соединения (например, обрыв сети) — логируем, пул живой.
  process.stderr.write(`Неожидаемая ошибка пула PostgreSQL: ${err.message}\n`);
});

/** Пул подключается лениво, поэтому проверка — обычный запрос SELECT 1. */
export async function checkDbConnection(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch (err) {
    process.stderr.write(`Проверка соединения с PostgreSQL не прошла: ${(err as Error).message}\n`);
    return false;
  }
}

/** Закрытие пула для graceful shutdown. */
export async function closePool(): Promise<void> {
  await pool.end();
}
