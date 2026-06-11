/**
 * Integration test: the ingest WRITE path (repo upserts) against the real schema
 * in PGlite. Proves the load-bearing Western-language NATURAL-KEY COLLAPSE - two
 * languages of one physical card resolve to ONE card_print row + per-language
 * localizations - and the idempotent conflict-merge semantics (sticky booleans,
 * don't-wipe-with-empty arrays). repo functions take a `client`, so PGlite is
 * passed in directly.
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
import type { PoolClient } from '@proxyforge/db';
import { upsertCardPrint, upsertLocalization } from '../src/repo.js';
import type { NormalizedCard } from '../src/types.js';

const SCHEMA_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../../db/schema.sql');
const SET = '00000000-0000-0000-0000-0000000000a1';

async function freshDb(): Promise<PGlite> {
  const sql = readFileSync(SCHEMA_PATH, 'utf8')
    .split('\n')
    .filter((l) => !/pg_bigm|gin_bigm_ops/.test(l))
    .join('\n');
  const db = new PGlite({ extensions: { pg_trgm, citext, pgcrypto } });
  await db.exec(sql);
  await db.exec(`
    INSERT INTO series (id,tcgdex_id,name_en) VALUES ('00000000-0000-0000-0000-000000000001','sv','S&V');
    INSERT INTO card_set (id,set_id,series_id,name_en) VALUES ('${SET}','sv01','00000000-0000-0000-0000-000000000001','S&V');
  `);
  return db;
}

const card = (p: Partial<NormalizedCard>): NormalizedCard => ({
  sourceId: 'sv1-1',
  localId: '001',
  name: 'Pikachu',
  isPromo: false,
  isDigitalOnly: false,
  raw: {},
  ...p,
});

test('Western collapse: same (set, collector) across langs -> 1 card_print, many localizations', async () => {
  const db = await freshDb();
  const client = db as unknown as PoolClient;

  // EN ingest first (seeds the shared row + language-independent fields)
  const id1 = await upsertCardPrint(client, SET, card({ localId: '001', subtypes: ['Basic'] }));
  await upsertLocalization(client, id1, 'en', card({ name: 'Pikachu' }));

  // FR ingest of the SAME physical card. Printed '1' normalizes to the same key
  // as '001', so it must collapse onto the existing row, not create a new one.
  const id2 = await upsertCardPrint(client, SET, card({ localId: '1', subtypes: [] }));
  await upsertLocalization(client, id2, 'fr', card({ name: 'Pikachu (fr)' }));

  assert.equal(id1, id2); // collapsed to one physical card_print

  const prints = await db.query<{ n: number; norm: string; slug: string }>(
    'SELECT count(*)::int n, max(collector_number_norm) norm, max(slug) slug FROM card_print',
  );
  assert.equal(prints.rows[0]!.n, 1);
  assert.equal(prints.rows[0]!.norm, '1'); // 001 -> 1
  assert.equal(prints.rows[0]!.slug, 'sv01-001'); // raw kept from the first (EN) insert

  const locs = await db.query<{ lang: string; name: string }>(
    'SELECT lang, name FROM card_localization WHERE card_print_id=$1 ORDER BY lang',
    [id1],
  );
  assert.deepEqual(
    locs.rows.map((r) => [r.lang, r.name]),
    [
      ['en', 'Pikachu'],
      ['fr', 'Pikachu (fr)'],
    ],
  );

  // subtypes merge: FR sent [] -> EN's ['Basic'] preserved, not wiped
  const st = await db.query<{ subtypes: string[] }>('SELECT subtypes FROM card_print WHERE id=$1', [id1]);
  assert.deepEqual(st.rows[0]!.subtypes, ['Basic']);
  await db.close();
});

test('sticky is_promo: once any printing marks promo, a later pass cannot un-set it', async () => {
  const db = await freshDb();
  const client = db as unknown as PoolClient;
  const id = await upsertCardPrint(client, SET, card({ isPromo: false }));
  await upsertCardPrint(client, SET, card({ isPromo: true })); // a later pass flags promo
  await upsertCardPrint(client, SET, card({ isPromo: false })); // must NOT clear it
  const r = await db.query<{ is_promo: boolean }>('SELECT is_promo FROM card_print WHERE id=$1', [id]);
  assert.equal(r.rows[0]!.is_promo, true);
  await db.close();
});
