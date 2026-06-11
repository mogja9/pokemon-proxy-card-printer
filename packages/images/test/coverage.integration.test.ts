/**
 * Integration test: load the REAL db/schema.sql into an in-process Postgres
 * (PGlite, WASM - no Docker, no service) and run the actual COVERAGE_SQL against
 * a seeded fixture. Proves the schema, the card_display materialized view, the
 * collector-number trigger, and the coverage query for real, not just at the
 * type level. pg_bigm (CJK bigram) is the only schema feature PGlite lacks, so
 * its extension + 5 bigram indexes are stripped; nothing under test uses them.
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
import { getCoverage } from '../src/coverage.js';

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

// height_px 1024 -> 295.6 dpi (hi-res, >=290); 825 -> 238.1 (standard ~242)
const FIXTURE = `
INSERT INTO series (id,tcgdex_id,name_en) VALUES ('00000000-0000-0000-0000-000000000001','sv','S&V');
INSERT INTO card_set (id,set_id,series_id,name_en,ptcg_code)
  VALUES ('00000000-0000-0000-0000-0000000000a1','sv01','00000000-0000-0000-0000-000000000001','S&V','SVI');
INSERT INTO card_print (id,card_set_id,collector_number_raw) VALUES
 ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000a1','001'),
 ('00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000a1','002'),
 ('00000000-0000-0000-0000-0000000000c3','00000000-0000-0000-0000-0000000000a1','003'),
 ('00000000-0000-0000-0000-0000000000c4','00000000-0000-0000-0000-0000000000a1','004');
INSERT INTO card_localization (card_print_id,lang,name) VALUES
 ('00000000-0000-0000-0000-0000000000c1','en','A'),('00000000-0000-0000-0000-0000000000c1','fr','Afr'),
 ('00000000-0000-0000-0000-0000000000c2','en','B'),
 ('00000000-0000-0000-0000-0000000000c3','en','C'),('00000000-0000-0000-0000-0000000000c3','fr','Cfr'),
 ('00000000-0000-0000-0000-0000000000c4','en','D');
-- A: en 296 + fr 242 ; B: en 296 ; C: en 296 only (fr falls back to EN) ; D: no image
INSERT INTO image_variant (card_print_id,lang,origin,serving_mode,storage_key,format,height_px,quality_rank) VALUES
 ('00000000-0000-0000-0000-0000000000c1','en','malie_io','cache','k1','png',1024,80),
 ('00000000-0000-0000-0000-0000000000c1','fr','tcgdex_assets','cache','k2','png',825,60),
 ('00000000-0000-0000-0000-0000000000c2','en','malie_io','cache','k3','png',1024,80),
 ('00000000-0000-0000-0000-0000000000c3','en','malie_io','cache','k4','png',1024,80);
`;

test('schema loads in PGlite; trigger derives slug + normalized collector number', async () => {
  const db = await freshDb();
  const tables = await db.query<{ n: number }>(
    "SELECT count(*)::int n FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE ns.nspname='public' AND c.relkind='r'",
  );
  assert.ok(tables.rows[0]!.n >= 15, `expected the full schema, got ${tables.rows[0]!.n} tables`);
  // normalize_collector_number must keep interior zeros (the 100 vs 10 collision)
  const norm = await db.query<{ a: string; b: string }>(
    "SELECT normalize_collector_number('010') a, normalize_collector_number('100') b",
  );
  assert.equal(norm.rows[0]!.a, '10');
  assert.equal(norm.rows[0]!.b, '100');
  await db.exec(FIXTURE);
  const slug = await db.query<{ slug: string; norm: string }>(
    "SELECT slug, collector_number_norm norm FROM card_print WHERE collector_number_raw='001'",
  );
  assert.equal(slug.rows[0]!.slug, 'sv01-001'); // set_id || '-' || raw
  assert.equal(slug.rows[0]!.norm, '1'); // 001 -> 1
  await db.close();
});

test('getCoverage(): the REAL function returns correct typed CoverageRows', async () => {
  const db = await freshDb();
  await db.exec(FIXTURE);
  await db.exec('REFRESH MATERIALIZED VIEW card_display');
  __setTestQueryRunner(db); // route @proxyforge/db.query at PGlite
  try {
    const rows = await getCoverage();
    const pick = (lang: string) => rows.find((r) => r.setId === 'sv01' && r.lang === lang)!;
    // full-object deepEqual proves the bigint->Number coercion + row shape too
    assert.deepEqual(pick('en'), {
      setId: 'sv01', lang: 'en', eligible: 4, anyImage: 3, hires: 3, native: 3, enFallback: 0, missing: 1,
    });
    assert.deepEqual(pick('fr'), {
      setId: 'sv01', lang: 'fr', eligible: 2, anyImage: 2, hires: 1, native: 1, enFallback: 1, missing: 0,
    });
  } finally {
    __setTestQueryRunner(null);
    await db.close();
  }
});
