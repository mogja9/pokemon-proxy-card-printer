/**
 * Integration test for the POST /api/deck/resolve route handler - the external
 * surface the print page calls. Covers input validation (bad JSON, empty/blank
 * text -> 400, lang whitelist with EN fallback) and a real resolution against
 * the schema in PGlite (resolveDeckList routed at @proxyforge/db). The handler
 * is a plain function taking a Request, so it is called directly.
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
import { POST } from '../app/api/deck/resolve/route';

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
 ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000a1','094','Pokemon');
INSERT INTO card_localization (card_print_id,lang,name) VALUES
 ('00000000-0000-0000-0000-0000000000c1','en','Pikachu');
`;

const post = (body: BodyInit) =>
  POST(
    new Request('http://x/api/deck/resolve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    }) as unknown as Parameters<typeof POST>[0],
  );

test('rejects malformed JSON with 400', async () => {
  const res = await post('{ not json');
  assert.equal(res.status, 400);
  assert.match(await res.text(), /invalid JSON/);
});

test('rejects empty or whitespace-only decklists with 400', async () => {
  assert.equal((await post(JSON.stringify({ text: '' }))).status, 400);
  assert.equal((await post(JSON.stringify({ text: '   \n  ' }))).status, 400);
  assert.equal((await post(JSON.stringify({}))).status, 400); // missing text
});

test('resolves a valid decklist and returns resolved/unresolved JSON', async () => {
  const db = await freshDb();
  await db.exec(FIXTURE);
  __setTestQueryRunner(db);
  try {
    const res = await post(JSON.stringify({ text: '4 Pikachu SVI 94\n1 Nope ZZZ 1', lang: 'en' }));
    assert.equal(res.status, 200);
    const data = (await res.json()) as {
      resolved: { qty: number; slug: string }[];
      unresolved: { name: string }[];
    };
    assert.deepEqual(
      data.resolved.map((r) => [r.qty, r.slug]),
      [[4, 'sv01-094']],
    );
    assert.equal(data.unresolved.length, 1);
    assert.equal(data.unresolved[0]!.name, 'Nope');
  } finally {
    __setTestQueryRunner(null);
    await db.close();
  }
});

test('an unknown lang falls back to en rather than failing', async () => {
  const db = await freshDb();
  await db.exec(FIXTURE);
  __setTestQueryRunner(db);
  try {
    const res = await post(JSON.stringify({ text: '1 Pikachu SVI 94', lang: 'klingon' }));
    assert.equal(res.status, 200);
    const data = (await res.json()) as { resolved: { lang: string }[] };
    assert.equal(data.resolved[0]!.lang, 'en');
  } finally {
    __setTestQueryRunner(null);
    await db.close();
  }
});
