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
import { __setTestQueryRunner } from '@proxyforge/db';
import { DECK_BY_SETCODE_BATCH_SQL, resolveDeckList } from '../src/deck.js';

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
INSERT INTO card_print (id,card_set_id,collector_number_raw,supertype) VALUES
 ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000a1','094','Pokemon'),
 ('00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000a1','189','Trainer');
INSERT INTO card_localization (card_print_id,lang,name) VALUES
 ('00000000-0000-0000-0000-0000000000c1','en','Pikachu'),
 ('00000000-0000-0000-0000-0000000000c2','en','Iono');
`;

test('batched set-code resolution: zero-pad + case agnostic, NULL for misses, order kept', async () => {
  const db = await freshDb();
  await db.exec(FIXTURE);
  // decklist "94" matches stored "094" (both normalize to "94"); "svi" matches
  // SVI (lower on both sides); "999" has no card -> NULL, in input order.
  const r = await db.query<{ idx: number; slug: string | null }>(DECK_BY_SETCODE_BATCH_SQL, [
    ['SVI', 'svi', 'SVI'],
    ['94', '189', '999'],
  ]);
  assert.deepEqual(
    r.rows.map((x) => [Number(x.idx), x.slug]),
    [
      [1, 'sv01-094'],
      [2, 'sv01-189'],
      [3, null],
    ],
  );
  await db.close();
});

test('resolveDeckList(): real function - parse + batch + assemble, order/qty kept', async () => {
  const db = await freshDb();
  await db.exec(FIXTURE);
  __setTestQueryRunner(db); // route @proxyforge/db.query at PGlite
  try {
    const deck = [
      '4 Pikachu SVI 94', // set code + number (stored 094)
      '2 Iono', // name-only -> name fallback
      '1 Ghost OBF 999', // set-code miss then name miss -> unresolved
      '3 PIKACHU', // name fallback, case-insensitive
    ].join('\n');
    const res = await resolveDeckList(deck, 'en');
    // resolved keeps input order + qty; PIKACHU resolves via the name pass
    assert.deepEqual(
      res.resolved.map((r) => [r.qty, r.slug, r.supertype]),
      [
        [4, 'sv01-094', 'Pokemon'], // resolved by set code + number
        [2, 'sv01-189', 'Trainer'], // name fallback carries supertype too
        [3, 'sv01-094', 'Pokemon'],
      ],
    );
    assert.equal(res.unresolved.length, 1);
    assert.equal(res.unresolved[0]!.name, 'Ghost');
    assert.match(res.unresolved[0]!.reason, /OBF 999/);
  } finally {
    __setTestQueryRunner(null);
    await db.close();
  }
});
