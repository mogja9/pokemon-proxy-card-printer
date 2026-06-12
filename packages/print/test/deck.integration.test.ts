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
import { DECK_BY_SETCODE_BATCH_SQL, DECK_BY_NAME_BATCH_SQL, resolveDeckList } from '../src/deck.js';

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

// A suppressed print (legal takedown / bad data) must never resolve - by set
// code+number OR by name - so it can't be added to a print list.
const SUPPRESSED_FIXTURE = `
INSERT INTO series (id,tcgdex_id,name_en) VALUES ('00000000-0000-0000-0000-000000000001','sv','S&V');
INSERT INTO card_set (id,set_id,series_id,name_en,ptcg_code,release_date)
  VALUES ('00000000-0000-0000-0000-0000000000a1','sv01','00000000-0000-0000-0000-000000000001','S&V','SVI','2023-03-31');
INSERT INTO card_print (id,card_set_id,collector_number_raw,supertype,is_suppressed) VALUES
 ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000a1','050','Pokemon',true);
INSERT INTO card_localization (card_print_id,lang,name) VALUES
 ('00000000-0000-0000-0000-0000000000d1','en','Banned Mon');
`;

test('suppressed prints never resolve, by set code or by name', async () => {
  const db = await freshDb();
  await db.exec(SUPPRESSED_FIXTURE);
  // raw SQL: set code + number hits the suppressed row -> NULL
  const r = await db.query<{ idx: number; slug: string | null }>(DECK_BY_SETCODE_BATCH_SQL, [
    ['SVI'],
    ['50'],
  ]);
  assert.equal(r.rows[0]!.slug, null);
  // raw SQL: name match hits the suppressed row -> NULL
  const n = await db.query<{ idx: number; slug: string | null }>(DECK_BY_NAME_BATCH_SQL, [
    ['Banned Mon'],
    'en',
  ]);
  assert.equal(n.rows[0]!.slug, null);

  __setTestQueryRunner(db);
  try {
    const res = await resolveDeckList('2 Banned Mon SVI 50\n1 Banned Mon', 'en');
    assert.equal(res.resolved.length, 0);
    assert.equal(res.unresolved.length, 2);
  } finally {
    __setTestQueryRunner(null);
    await db.close();
  }
});

// Two prints share a name: the name fallback must prefer a localization in the
// REQUESTED language over EN, and only then fall back to the newest set.
const NAME_PREF_FIXTURE = `
INSERT INTO series (id,tcgdex_id,name_en) VALUES ('00000000-0000-0000-0000-000000000001','sv','S&V');
INSERT INTO card_set (id,set_id,series_id,name_en,ptcg_code,release_date) VALUES
 ('00000000-0000-0000-0000-0000000000a1','sv01','00000000-0000-0000-0000-000000000001','S&V old','SVI','2023-03-31'),
 ('00000000-0000-0000-0000-0000000000a2','sv02','00000000-0000-0000-0000-000000000001','S&V new','PAL','2024-01-01');
-- cA in the OLDER set has a FR localization; cB in the NEWER set is EN-only
INSERT INTO card_print (id,card_set_id,collector_number_raw,supertype) VALUES
 ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000a1','001','Pokemon'),
 ('00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000a2','002','Pokemon');
INSERT INTO card_localization (card_print_id,lang,name) VALUES
 ('00000000-0000-0000-0000-0000000000b1','en','Pikachu'),('00000000-0000-0000-0000-0000000000b1','fr','Pikachu'),
 ('00000000-0000-0000-0000-0000000000b2','en','Pikachu');
`;

test('name fallback prefers requested-lang localization, else newest set', async () => {
  const db = await freshDb();
  await db.exec(NAME_PREF_FIXTURE);
  __setTestQueryRunner(db);
  try {
    // fr: the FR-localized print (older set sv01) outranks the EN-only newer one
    const fr = await resolveDeckList('1 Pikachu', 'fr');
    assert.equal(fr.resolved[0]!.slug, 'sv01-001');
    // en: no lang preference -> newest set (sv02) wins the release_date tiebreak
    const en = await resolveDeckList('1 Pikachu', 'en');
    assert.equal(en.resolved[0]!.slug, 'sv02-002');
  } finally {
    __setTestQueryRunner(null);
    await db.close();
  }
});
