import type { PoolClient } from '@neondatabase/serverless';
import { createPool } from '../../db/client';

let pool: ReturnType<typeof createPool> | undefined;

function getPool(): ReturnType<typeof createPool> {
  if (!pool) pool = createPool();
  return pool;
}

/** One transaction, pinned to the allsquare schema. */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL search_path TO allsquare');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* the connection may already be closed */
    }
    throw error;
  } finally {
    client.release();
  }
}

export type { PoolClient };
