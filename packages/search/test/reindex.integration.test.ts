/**
 * Integration test: run the REAL reindexAll against the real schema in PGlite
 * with a recording fake Meili client. Exercises the SELECT over card_display,
 * keyset pagination (small batchSize -> multiple pages), rowToDoc mapping, and
 * the per-LANGUAGE index routing (PR: per-language indexes) end to end - none of
 * which was covered before.
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
import { reindexAll } from '../src/reindex.js';
import type { MeiliClient } from '../src/client.js';
import type { CardDoc } from '../src/document.js';

const SCHEMA_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../../db/schema.sql');

async function freshDb(): Promise<PGlite> {
  const sql = readFileSync(SCHEMA_PATH, 'utf8')
    .split('\n')
    .filter((l) => !/pg_bigm|gin_bigm_ops/.test(l))
    .join('\n');
  const db = new PGlite({ extensions: { pg_trgm, citext, pgcrypto } });
  await db.exec(sql);
  // One EN card with a stored image -> card_display yields an EN native row plus
  // an EN-fallback row for each of the other 9 launch langs (all 10 indexes hit).
  await db.exec(`
    INSERT INTO series (id,tcgdex_id,name_en) VALUES ('00000000-0000-0000-0000-000000000001','sv','S&V');
    INSERT INTO card_set (id,set_id,series_id,name_en,release_date)
      VALUES ('00000000-0000-0000-0000-0000000000a1','sv01','00000000-0000-0000-0000-000000000001','S&V','2023-03-31');
    INSERT INTO card_print (id,card_set_id,collector_number_raw)
      VALUES ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000a1','001');
    INSERT INTO card_localization (card_print_id,lang,name)
      VALUES ('00000000-0000-0000-0000-0000000000c1','en','Pikachu');
    INSERT INTO image_variant (card_print_id,lang,origin,serving_mode,storage_key,format,height_px,quality_rank)
      VALUES ('00000000-0000-0000-0000-0000000000c1','en','malie_io','cache','k1','png',1024,80);
  `);
  await db.exec('REFRESH MATERIALIZED VIEW card_display');
  return db;
}

interface Added {
  uid: string;
  docs: CardDoc[];
}

function recordingClient(added: Added[]): MeiliClient {
  let task = 0;
  return {
    ensureIndex: async () => {},
    updateSettings: async () => ({ taskUid: ++task }),
    waitForTask: async () => ({}),
    addDocuments: async (uid: string, docs: CardDoc[]) => {
      added.push({ uid, docs });
      return { taskUid: ++task };
    },
  } as unknown as MeiliClient;
}

test('reindexAll: paginates card_display and routes docs to per-language indexes', async () => {
  const db = await freshDb();
  const added: Added[] = [];
  __setTestQueryRunner(db);
  try {
    // batchSize 3 -> the 10 (card,lang) rows span 4 keyset pages
    const res = await reindexAll(recordingClient(added), { refreshMv: false, batchSize: 3 });
    assert.equal(res.indexed, 10); // EN native + 9 EN-fallback langs

    const uids = new Set(added.map((a) => a.uid));
    assert.ok(uids.has('cards_en'), 'routed to cards_en');
    assert.ok(uids.has('cards_ja'), 'routed to cards_ja');
    assert.ok(uids.has('cards_zh-cn'), 'routed to cards_zh-cn (hyphenated lang uid)');
    assert.equal(uids.size, 10); // one index per launch lang

    // every routed doc went to the index matching its own lang
    for (const { uid, docs } of added) {
      for (const d of docs) assert.equal(uid, `cards_${d.lang}`);
    }
    // the EN doc carries the real name + nameEn from the read-model
    const enDoc = added.find((a) => a.uid === 'cards_en')!.docs[0]!;
    assert.equal(enDoc.name, 'Pikachu');
    assert.equal(enDoc.nameEn, 'Pikachu');
    assert.equal(enDoc.setId, 'sv01');
  } finally {
    __setTestQueryRunner(null);
    await db.close();
  }
});
