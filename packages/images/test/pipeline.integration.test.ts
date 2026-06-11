/**
 * Integration test: the image pipeline's core WRITE path (upsertStored) against
 * the real schema in PGlite. Validates the param->column mapping, the generated
 * dpi_at_trim, the chk_servable/chk_ephemeral_ttl constraints (serving_mode
 * 'cache'), and the ON CONFLICT update semantics - the bits a unit test can't see.
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
import { upsertStored } from '../src/pipeline.js';

const SCHEMA_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../../db/schema.sql');
const CARD = '00000000-0000-0000-0000-0000000000c1';

async function freshDb(): Promise<PGlite> {
  const sql = readFileSync(SCHEMA_PATH, 'utf8')
    .split('\n')
    .filter((l) => !/pg_bigm|gin_bigm_ops/.test(l))
    .join('\n');
  const db = new PGlite({ extensions: { pg_trgm, citext, pgcrypto } });
  await db.exec(sql);
  await db.exec(`
    INSERT INTO series (id,tcgdex_id,name_en) VALUES ('00000000-0000-0000-0000-000000000001','sv','S&V');
    INSERT INTO card_set (id,set_id,series_id,name_en) VALUES ('00000000-0000-0000-0000-0000000000a1','sv01','00000000-0000-0000-0000-000000000001','S&V');
    INSERT INTO card_print (id,card_set_id,collector_number_raw) VALUES ('${CARD}','00000000-0000-0000-0000-0000000000a1','001');
  `);
  return db;
}

const base = {
  cardPrintId: CARD,
  lang: 'en' as const,
  origin: 'malie_io',
  storageKey: 'k1',
  remoteUrl: 'https://cdn.malie.io/r1.png',
  width: 733,
  height: 1024, // -> dpi_at_trim 295.6 (hi-res)
  hasAlpha: true,
  checksum: 'sha1',
  byteSize: 600000,
  qualityRank: 80,
};

test('upsertStored: INSERT maps every column + generated dpi + cache serving mode', async () => {
  const db = await freshDb();
  __setTestQueryRunner(db);
  try {
    await upsertStored(base);
    const r = await db.query<Record<string, unknown>>(
      `SELECT origin, serving_mode, source_url, remote_url, storage_key, width_px, height_px,
              dpi_at_trim, has_transparent_corners, checksum_sha256, byte_size, quality_rank,
              ingest_status, has_bleed, is_upscaled
       FROM image_variant WHERE card_print_id=$1 AND lang='en'`,
      [CARD],
    );
    assert.equal(r.rows.length, 1);
    const v = r.rows[0]!;
    assert.equal(v.origin, 'malie_io');
    assert.equal(v.serving_mode, 'cache'); // satisfies chk_ephemeral_ttl without expires_at
    assert.equal(v.storage_key, 'k1');
    assert.equal(v.source_url, base.remoteUrl);
    assert.equal(v.remote_url, base.remoteUrl);
    assert.equal(Number(v.width_px), 733);
    assert.equal(Number(v.height_px), 1024);
    assert.equal(Number(v.dpi_at_trim), 295.6); // generated column from height
    assert.equal(v.has_transparent_corners, true); // <- hasAlpha
    assert.equal(v.checksum_sha256, 'sha1');
    assert.equal(Number(v.byte_size), 600000);
    assert.equal(Number(v.quality_rank), 80);
    assert.equal(v.ingest_status, 'ok');
    assert.equal(v.has_bleed, false); // conflict-key defaults
    assert.equal(v.is_upscaled, false);
  } finally {
    __setTestQueryRunner(null);
    await db.close();
  }
});

test('upsertStored: ON CONFLICT updates in place; keeps the original remote_url', async () => {
  const db = await freshDb();
  __setTestQueryRunner(db);
  try {
    await upsertStored(base);
    // re-fetch: new storage_key/quality, DIFFERENT remote_url
    await upsertStored({ ...base, storageKey: 'k2', qualityRank: 100, remoteUrl: 'https://other/r2.png' });
    const r = await db.query<Record<string, unknown>>(
      `SELECT storage_key, remote_url, quality_rank FROM image_variant WHERE card_print_id=$1 AND lang='en'`,
      [CARD],
    );
    assert.equal(r.rows.length, 1); // updated in place, not a 2nd row
    assert.equal(r.rows[0]!.storage_key, 'k2'); // overwritten
    assert.equal(Number(r.rows[0]!.quality_rank), 100); // overwritten
    assert.equal(r.rows[0]!.remote_url, base.remoteUrl); // COALESCE(existing, new) keeps the original
  } finally {
    __setTestQueryRunner(null);
    await db.close();
  }
});
