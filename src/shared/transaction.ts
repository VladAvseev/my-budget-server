import { pool } from '@/db/pool.js';
import type { PoolClient } from 'pg';

/**
 * Оборачивает набор запросов в одну SQL-транзакцию (BEGIN / COMMIT / ROLLBACK).
 *
 * Нужен там, где в Supabase логика изначально была «несколько statement'ов
 * в одной RPC-функции» (plpgsql-функция выполняется в одной транзакции
 * автоматически). Здесь без явного BEGIN несколько отдельных pool.query()
 * могли бы частично закоммититься при ошибке на середине — например,
 * set_category_limits удалил старые лимиты, но не вставил новые.
 *
 * Колбэк получает PoolClient — все запросы внутри обязаны идти через него,
 * иначе уйдут на свободное соединение из пула вне транзакции.
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    // Откатываем всё или ничего — как в plpgsql-функции Supabase.
    await client.query('ROLLBACK');
    throw error;
  } finally {
    // Соединение всегда возвращается в пул, даже если ROLLBACK упал.
    client.release();
  }
}
