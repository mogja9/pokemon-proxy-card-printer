/**
 * Integration test: run the decklist-resolution SQL against the REAL schema in
 * PGlite (in-process Postgres, no Docker). Proves set-code+number resolution via
 * card_set.ptcg_code + normalize_collector_number, and the name fallback - the
 * queries the /api/deck/resolve route runs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { DECK_BY_SETCODE_SQL, DECK_BY_NAME_SQL } from '../src/deck.js';

const SCHEMA_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../../db/schema.sql');

async function freshDb(): Promise<PGlite> {
  const sql = readFileSync(SCHEMA_PATH, 'utf8')
    .split('\n')
    .filter((l) => !/pg_bigm|gin_bigm_ops/.test(l))
    .join('\n');
  const db = new PGlite({ extensions: { pg_trgm, citext, pgcrypto } });
  await db.exec(sql);
  return db;
}

const FIXTURE = `
INSERT INTO series (id,tcgdex_id,name_en) VALUES ('00000000-0000-0000-0000-000000000001','sv','S&V');
INSERT INTO card_set (id,set_id,series_id,name_en,ptcg_code,release_date)
  VALUES ('00000000-0000-0000-0000-0000000000a1','sv01','00000000-0000-0000-0000-000000000001','S&V','SVI','2023-03-31');
INSERT INTO card_print (id,card_set_id,collector_number_raw) VALUES
 ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000a1','094'),
 ('00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000a1','189');
INSERT INTO card_localization (card_print_id,lang,name) VALUES
 ('00000000-0000-0000-0000-0000000000c1','en','Pikachu'),
 ('00000000-0000-0000-0000-0000000000c2','en','Iono');
`;

test('deck resolution: set code + number -> slug (zero-padding agnostic)', async () => {
  const db = await freshDb();
  await db.exec(FIXTURE);
  // decklist says "SVI 94"; stored raw is "094" -> both normalize to "94"
  const r = await db.query<{ slug: string }>(DECK_BY_SETCODE_SQL, ['SVI', '94']);
  assert.equal(r.rows[0]?.slug, 'sv01-094');
  // lowercase set code in the list still matches (lower() on both sides)
  const r2 = await db.query<{ slug: string }>(DECK_BY_SETCODE_SQL, ['svi', '189']);
  assert.equal(r2.rows[0]?.slug, 'sv01-189');
  // a number that does not exist -> no row
  const none = await db.query<{ slug: string }>(DECK_BY_SETCODE_SQL, ['SVI', '999']);
  assert.equal(none.rows.length, 0);
  await db.close();
});

test('deck resolution: name fallback (case-insensitive) for Trainer/Energy lines', async () => {
  const db = await freshDb();
  await db.exec(FIXTURE);
  const r = await db.query<{ slug: string }>(DECK_BY_NAME_SQL, ['iono', 'en']);
  assert.equal(r.rows[0]?.slug, 'sv01-189');
  const none = await db.query<{ slug: string }>(DECK_BY_NAME_SQL, ['Nonexistent Card', 'en']);
  assert.equal(none.rows.length, 0);
  await db.close();
});
