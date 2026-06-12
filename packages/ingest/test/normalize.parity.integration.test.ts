/**
 * Parity test: the JS normalizeCollectorNumber MUST stay byte-for-byte equal to
 * the SQL normalize_collector_number trigger (db/schema.sql) - the natural key
 * uq_card_print_natural depends on both agreeing, so drift in either silently
 * splits or collides card_print rows. normalize.test.ts pins the JS outputs;
 * this runs the REAL SQL function in PGlite and asserts JS === SQL for a battery
 * of inputs, including the separator / interior-zero / edge-whitespace cases.
 *
 * The SQL function uses only core builtins (lower/btrim/replace/regexp_replace),
 * so it is extracted and run on a bare PGlite with no schema or extensions.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { normalizeCollectorNumber } from '../src/normalize.js';

const SCHEMA_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../../db/schema.sql');

function extractSqlFunction(): string {
  const schema = readFileSync(SCHEMA_PATH, 'utf8');
  const m = schema.match(
    /CREATE OR REPLACE FUNCTION normalize_collector_number[\s\S]*?LANGUAGE plpgsql IMMUTABLE;/,
  );
  if (!m) throw new Error('normalize_collector_number not found in db/schema.sql');
  return m[0];
}

const INPUTS = [
  // leading / after-separator zero stripping
  '001', '010', '0010', '00100', '000', '0', '25',
  'TG 12', 'GG01', 'SWSH001', 'SV-P-001', 'sv-p-001',
  // interior zeros kept (the 100 vs 10 collision guard)
  '100', '200', '105', '10', '01000',
  // mixed case + alnum prefixes
  'Gg01', 'tg12a', 'A00B01', 'h', 'H1',
  // spaces everywhere vs edges
  ' 001 ', '0 0 1', 'TG  12',
  // edge tabs/newlines: SQL btrim is ASCII-space only, so they must survive
  '\t001', '001\n', '\n0010\t',
  // empty + already-normal
  '', 'abc', 'sv1',
];

test('normalizeCollectorNumber (JS) matches normalize_collector_number (SQL) byte-for-byte', async () => {
  const db = new PGlite();
  try {
    await db.exec(extractSqlFunction());
    for (const input of INPUTS) {
      const res = await db.query<{ n: string }>('SELECT normalize_collector_number($1) AS n', [
        input,
      ]);
      const sql = res.rows[0]!.n;
      const js = normalizeCollectorNumber(input);
      assert.equal(js, sql, `mismatch for ${JSON.stringify(input)}: JS=${JSON.stringify(js)} SQL=${JSON.stringify(sql)}`);
    }
  } finally {
    await db.close();
  }
});
