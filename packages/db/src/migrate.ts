/**
 * Migration runner. The canonical DDL IS db/schema.sql (single source of truth);
 * this applies it verbatim, idempotently-ish (schema.sql uses IF NOT EXISTS for
 * extensions; CREATE TABLE will error if re-run on a populated DB - intended:
 * run once on a clean DB, or use `--drop` in dev to reset).
 *
 *   npm run migrate            # apply schema.sql
 *   npm run migrate -- --drop  # DROP SCHEMA public CASCADE first (DEV ONLY)
 *   npm run migrate -- --check # apply to a throwaway, just to validate it parses/runs
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { getPool, closePool } from './index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolve(__dirname, '../../../db/schema.sql');

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const drop = args.has('--drop');
  const check = args.has('--check');

  const sql = await readFile(SCHEMA_PATH, 'utf8');
  const pool = getPool();

  // --check: validate the DDL parses + executes without persisting anything,
  // by applying it inside a transaction and rolling back.
  if (check) {
    console.log(`[migrate] --check: applying ${SCHEMA_PATH} in a transaction, then ROLLBACK`);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('ROLLBACK');
      console.log('[migrate] --check OK: schema.sql applies cleanly (rolled back, nothing persisted)');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    return;
  }

  if (drop) {
    console.warn('[migrate] --drop: DROP SCHEMA public CASCADE (dev reset)');
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  }

  console.log(`[migrate] applying ${SCHEMA_PATH} (${(sql.length / 1024).toFixed(1)} KiB)`);
  await pool.query(sql);

  const { rows } = await pool.query<{ relname: string }>(
    `SELECT relname FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
     ORDER BY relname`,
  );
  console.log(`[migrate] OK - ${rows.length} tables: ${rows.map((r) => r.relname).join(', ')}`);
}

main()
  .catch((err) => {
    console.error('[migrate] FAILED:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => {
    void closePool();
  });
