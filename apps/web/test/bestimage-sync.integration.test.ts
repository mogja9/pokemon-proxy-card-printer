/**
 * Parity test for the load-bearing "best-image SYNC" invariant. The image-pick
 * WHERE + ORDER BY is duplicated in the card_display materialized view
 * (db/schema.sql) and in lib/db.ts BEST_IMAGE (used by browse + getCardBySlug).
 * The schema comment warns they MUST stay identical, or the materialized
 * preview and a fresh detail/render pick a different scan. Nothing enforced it.
 *
 * This loads the real schema in PGlite, inserts variants crafted to exercise
 * every tiebreak (lang preference over higher EN rank, EN fallback, quality_rank
 * DESC, stored-over-remote at equal rank, has_bleed exclusion, id tiebreak),
 * REFRESHes card_display, then asserts that for EVERY (slug, lang) row the MV
 * produced, the REAL getCardBySlug picks the byte-identical image + lang + flag.
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
import type { Lang } from '@proxyforge/config';
import { getCardBySlug } from '../lib/db';

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

// c1: fr beats higher-rank EN by lang preference; ja falls back to EN.
// c2: EN-only, fr/ja are EN fallbacks. c3: stored beats remote at equal rank.
// c4: a higher-rank + lower-id BLEED canvas must be excluded; equal-rank stored
//     pair resolved by id tiebreak ('kc4a' < 'kc4b' -> id order).
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
 ('00000000-0000-0000-0000-0000000000c3','en','C'),
 ('00000000-0000-0000-0000-0000000000c4','en','D');
INSERT INTO image_variant (id,card_print_id,lang,origin,serving_mode,storage_key,remote_url,format,height_px,quality_rank,has_bleed) VALUES
 -- c1: en stored rank 80, fr stored rank 60, en bleed rank 100 (excluded)
 ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000c1','en','malie_io','cache','c1en',NULL,'png',1024,80,false),
 ('00000000-0000-0000-0000-0000000000f2','00000000-0000-0000-0000-0000000000c1','fr','tcgdex_assets','cache','c1fr',NULL,'png',825,60,false),
 ('00000000-0000-0000-0000-0000000000f3','00000000-0000-0000-0000-0000000000c1','en','pokemontcg_io','cache','c1bleed',NULL,'png',1122,100,true),
 -- c2: en stored only
 ('00000000-0000-0000-0000-0000000000f4','00000000-0000-0000-0000-0000000000c2','en','malie_io','cache','c2en',NULL,'png',1024,80,false),
 -- c3: en stored vs en remote-only at equal rank -> stored wins
 ('00000000-0000-0000-0000-0000000000f5','00000000-0000-0000-0000-0000000000c3','en','malie_io','cache','c3stored',NULL,'png',1024,80,false),
 ('00000000-0000-0000-0000-0000000000f6','00000000-0000-0000-0000-0000000000c3','en','tcgdex_assets','cache',NULL,'https://r/c3','png',1024,80,false),
 -- c4: bleed (excluded) + two equal-rank stored -> id tiebreak picks f7
 ('00000000-0000-0000-0000-0000000000f7','00000000-0000-0000-0000-0000000000c4','en','malie_io','cache','kc4a',NULL,'png',1024,80,false),
 ('00000000-0000-0000-0000-0000000000f8','00000000-0000-0000-0000-0000000000c4','en','pokemontcg_io','cache','kc4b',NULL,'png',1024,80,false),
 ('00000000-0000-0000-0000-0000000000f9','00000000-0000-0000-0000-0000000000c4','en','tcgdex_assets','cache','kc4bleed',NULL,'png',1122,100,true);
`;

interface MvRow {
  slug: string;
  requested_lang: string;
  image_key: string | null;
  image_remote_url: string | null;
  image_lang: string;
  image_is_english_fallback: boolean;
  display_name: string;
}

test('card_display MV image + name pick matches lib/db getCardBySlug for every row', async () => {
  const db = await freshDb();
  await db.exec(FIXTURE);
  await db.exec('REFRESH MATERIALIZED VIEW card_display');
  __setTestQueryRunner(db);
  try {
    const mv = await db.query<MvRow>(
      `SELECT slug, requested_lang, image_key, image_remote_url, image_lang,
              image_is_english_fallback, display_name
       FROM card_display ORDER BY slug, requested_lang`,
    );
    // sanity: the fixtures must produce a meaningful spread of cases
    assert.ok(mv.rows.length >= 10, `expected many MV rows, got ${mv.rows.length}`);
    assert.ok(mv.rows.some((r) => r.image_is_english_fallback), 'need an EN-fallback case');
    assert.ok(mv.rows.some((r) => !r.image_is_english_fallback), 'need a native-lang case');

    for (const row of mv.rows) {
      const expectedUrl = row.image_key ? `/img/${row.image_key}` : row.image_remote_url;
      const detail = await getCardBySlug(row.slug, row.requested_lang as Lang);
      assert.ok(detail, `getCardBySlug returned null for ${row.slug}/${row.requested_lang}`);
      const ctx = `${row.slug}/${row.requested_lang}`;
      assert.equal(detail!.card.imageUrl, expectedUrl, `image url mismatch @ ${ctx}`);
      assert.equal(detail!.card.imageLang, row.image_lang, `image lang mismatch @ ${ctx}`);
      assert.equal(
        detail!.card.isEnFallback,
        row.image_is_english_fallback,
        `en-fallback flag mismatch @ ${ctx}`,
      );
      // NAME parity: for every card that carries EN (the universal case in this
      // dataset), the MV's requested->EN name fallback must equal the detail
      // page's COALESCE(cl.name, len.name). See OPEN_ITEMS for the MV-only 3rd
      // "any localization" tier that getCardBySlug does not implement.
      assert.equal(detail!.card.name, row.display_name, `display name mismatch @ ${ctx}`);
    }

    // spot-check the load-bearing tiebreaks resolved as intended
    const pick = (slug: string, lang: string) =>
      mv.rows.find((r) => r.slug === slug && r.requested_lang === lang)!;
    assert.equal(pick('sv01-001', 'fr').image_key, 'c1fr'); // lang preference over higher EN rank
    assert.equal(pick('sv01-001', 'ja').image_key, 'c1en'); // EN fallback
    assert.equal(pick('sv01-003', 'en').image_key, 'c3stored'); // stored over remote at equal rank
    assert.equal(pick('sv01-004', 'en').image_key, 'kc4a'); // bleed excluded; id tiebreak
    // name fallback: requested-lang name when present, else EN
    assert.equal(pick('sv01-001', 'fr').display_name, 'Afr'); // native fr name
    assert.equal(pick('sv01-001', 'ja').display_name, 'A'); // no ja loc -> EN fallback
  } finally {
    __setTestQueryRunner(null);
    await db.close();
  }
});
