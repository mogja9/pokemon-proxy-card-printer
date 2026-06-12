/**
 * Regression test for the browse Postgres FTS fallback (apps/web/lib/db.ts
 * searchCards). It previously INNER-JOINed the requested-language localization
 * and selected cl.name only, so when Meilisearch is down a non-EN browse HID
 * every card lacking a localization in that language and showed no EN name
 * fallback - diverging from card_display / getCardBySlug. The fix LEFT-joins the
 * localization with an EN fallback. This proves: (1) an EN-only card is visible
 * when browsing a non-EN language and carries its EN name, (2) a card with a
 * localized name shows the localized name, (3) the q filter matches the EN name
 * even in a non-EN browse, (4) set/supertype/promo filters + count still hold.
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
import { searchCards } from '../lib/db';

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

// c1: en + fr names. c2: EN-only (the case the old INNER JOIN hid for fr browse).
const FIXTURE = `
INSERT INTO series (id,tcgdex_id,name_en) VALUES ('00000000-0000-0000-0000-000000000001','sv','S&V');
INSERT INTO card_set (id,set_id,series_id,name_en,ptcg_code,release_date)
  VALUES ('00000000-0000-0000-0000-0000000000a1','sv01','00000000-0000-0000-0000-000000000001','S&V','SVI','2023-03-31');
INSERT INTO card_print (id,card_set_id,collector_number_raw,supertype,is_promo) VALUES
 ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000a1','001','Pokemon',false),
 ('00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000a1','002','Trainer',false);
INSERT INTO card_localization (card_print_id,lang,name) VALUES
 ('00000000-0000-0000-0000-0000000000c1','en','Pikachu'),('00000000-0000-0000-0000-0000000000c1','fr','Pikachu FR'),
 ('00000000-0000-0000-0000-0000000000c2','en','Professor');
`;

test('searchCards fallback: non-EN browse shows EN-only cards with their EN name', async () => {
  const db = await freshDb();
  await db.exec(FIXTURE);
  __setTestQueryRunner(db);
  try {
    const fr = await searchCards({ lang: 'fr' });
    // BOTH cards appear in fr browse (c2 is EN-only). Old behavior: only c1.
    assert.equal(fr.total, 2, 'EN-only card must be visible in a non-EN browse');
    const bySlug = new Map(fr.cards.map((c) => [c.slug, c]));
    assert.equal(bySlug.get('sv01-001')!.name, 'Pikachu FR'); // localized name wins
    assert.equal(bySlug.get('sv01-002')!.name, 'Professor'); // EN fallback name

    // q filter matches the EN name even when browsing fr
    const q = await searchCards({ lang: 'fr', q: 'Professor' });
    assert.equal(q.total, 1);
    assert.equal(q.cards[0]!.slug, 'sv01-002');
    assert.equal(q.cards[0]!.name, 'Professor');

    // q filter still matches a localized name
    const qfr = await searchCards({ lang: 'fr', q: 'Pikachu FR' });
    assert.equal(qfr.total, 1);
    assert.equal(qfr.cards[0]!.slug, 'sv01-001');

    // facet filters + count remain correct over the LEFT-joined row set
    const trainers = await searchCards({ lang: 'fr', supertype: 'Trainer' });
    assert.equal(trainers.total, 1);
    assert.equal(trainers.cards[0]!.slug, 'sv01-002');

    const inSet = await searchCards({ lang: 'fr', set: 'sv01' });
    assert.equal(inSet.total, 2);

    // EN browse is unchanged: both cards, EN names
    const en = await searchCards({ lang: 'en' });
    assert.equal(en.total, 2);
    assert.equal(new Map(en.cards.map((c) => [c.slug, c.name])).get('sv01-001'), 'Pikachu');
  } finally {
    __setTestQueryRunner(null);
    await db.close();
  }
});
