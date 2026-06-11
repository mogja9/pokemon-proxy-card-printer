import pg from 'pg';
import { loadConfig } from '@proxyforge/config';

const { Pool } = pg;

let pool: pg.Pool | undefined;

/** Lazily-created shared connection pool. */
export function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({ connectionString: loadConfig().databaseUrl, max: 10 });
  }
  return pool;
}

/** Minimal query interface an injected runner must satisfy (PGlite fits). */
export interface QueryRunner {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

let testRunner: QueryRunner | null = null;

/**
 * TEST-ONLY seam: route query()/the pool through an injected runner (e.g. an
 * in-process PGlite instance) so integration tests can exercise the REAL data
 * functions against a real Postgres without a DATABASE_URL. Pass null to reset.
 * Production code never calls this; the override is null by default.
 */
export function __setTestQueryRunner(runner: QueryRunner | null): void {
  testRunner = runner;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  if (testRunner) {
    const res = await testRunner.query(text, params);
    return res as unknown as pg.QueryResult<T>;
  }
  return getPool().query<T>(text, params as never[]);
}

/** Run `fn` inside a transaction; commits on success, rolls back on throw. */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

export type { Pool, PoolClient, QueryResult } from 'pg';
