import { pool } from '@/db/pool.js';
import type { PoolClient } from 'pg';

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {

    await client.query('ROLLBACK');
    throw error;
  } finally {

    client.release();
  }
}
