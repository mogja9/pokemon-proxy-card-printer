/**
 * Success-path test for POST /api/render - the only render-route path left
 * uncovered, and the one that exercises the 4th copy of the best-image SYNC
 * lateral (inline in the route) plus the full storage_key -> disk -> sharp ->
 * PDF/ZIP wiring and response headers. A real (sharp-generated) PNG is written
 * to a temp IMAGES_DIR and pointed at by an image_variant.storage_key in PGlite,
 * so the route's image lookup, on-disk load, and render all run for real.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import sharp from 'sharp';
import { __setTestQueryRunner } from '@proxyforge/db';
import { POST } from '../app/api/render/route';

const SCHEMA_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../../db/schema.sql');
const STORAGE_KEY = 'src/malie_io/en/sv01/001.png';

async function freshDb(): Promise<PGlite> {
  const sql = readFileSync(SCHEMA_PATH, 'utf8')
    .split('\n')
    .filter((l) => !/pg_bigm|gin_bigm_ops/.test(l))
    .join('\n');
  const db = new PGlite({ extensions: { pg_trgm, citext, pgcrypto } });
  await db.exec(sql);
  await db.exec(`
    INSERT INTO series (id,tcgdex_id,name_en) VALUES ('00000000-0000-0000-0000-000000000001','sv','S&V');
    INSERT INTO card_set (id,set_id,series_id,name_en,ptcg_code)
      VALUES ('00000000-0000-0000-0000-0000000000a1','sv01','00000000-0000-0000-0000-000000000001','S&V','SVI');
    INSERT INTO card_print (id,card_set_id,collector_number_raw) VALUES
     ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000a1','001');
    INSERT INTO card_localization (card_print_id,lang,name) VALUES
     ('00000000-0000-0000-0000-0000000000c1','en','Pikachu');
    INSERT INTO image_variant (card_print_id,lang,origin,serving_mode,storage_key,format,height_px,quality_rank)
      VALUES ('00000000-0000-0000-0000-0000000000c1','en','malie_io','cache','${STORAGE_KEY}','png',1024,80);
  `);
  return db;
}

const post = (body: unknown) =>
  POST(
    new Request('http://x/api/render', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }) as unknown as Parameters<typeof POST>[0],
  );

test('render route success path: stored image -> PDF and MPC ZIP', async () => {
  const base = await mkdtemp(join(tmpdir(), 'pf-render-'));
  const prevDir = process.env.IMAGES_DIR;
  process.env.IMAGES_DIR = base;
  const db = await freshDb();
  __setTestQueryRunner(db);
  try {
    // a real, decodable PNG on disk where the route's storage_key points
    await mkdir(dirname(join(base, STORAGE_KEY)), { recursive: true });
    const png = await sharp({
      create: { width: 734, height: 1024, channels: 3, background: { r: 200, g: 30, b: 30 } },
    })
      .png()
      .toBuffer();
    await writeFile(join(base, STORAGE_KEY), png);

    const items = [{ slug: 'sv01-001', lang: 'en', qty: 2 }];

    // PDF: the route resolves the image via its best-image lateral, loads it
    // from disk, and renders - 200 application/pdf with a %PDF magic header
    const pdf = await post({ items, target: 'pdf', paper: 'A4', dpi: 300 });
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    assert.match(pdf.headers.get('content-disposition') ?? '', /proxies\.pdf/);
    const pdfBytes = new Uint8Array(await pdf.arrayBuffer());
    assert.equal(new TextDecoder().decode(pdfBytes.slice(0, 5)), '%PDF-');

    // MPC: same lookup path, 200 application/zip (PK magic header)
    const zip = await post({ items, target: 'mpc', dpi: 300 });
    assert.equal(zip.status, 200);
    assert.equal(zip.headers.get('content-type'), 'application/zip');
    const zipBytes = new Uint8Array(await zip.arrayBuffer());
    assert.deepEqual([...zipBytes.slice(0, 2)], [0x50, 0x4b]); // 'PK'
  } finally {
    __setTestQueryRunner(null);
    if (prevDir === undefined) delete process.env.IMAGES_DIR;
    else process.env.IMAGES_DIR = prevDir;
    await db.close();
    await rm(base, { recursive: true, force: true });
  }
});
