/**
 * Validation coverage for the POST /api/render route handler - external surface
 * the print page posts to. Exercises the three guard paths that reject before
 * any image rendering: malformed JSON, an empty/invalid items list, and a list
 * whose cards resolve to no image. These 400s need no sharp/image fixtures; the
 * image-lookup query is routed through a stub runner (and, for the last case, a
 * real-but-empty PGlite) so nothing is actually rasterized.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { __setTestQueryRunner } from '@proxyforge/db';
import { POST } from '../app/api/render/route';

const post = (body: BodyInit) =>
  POST(
    new Request('http://x/api/render', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    }) as unknown as Parameters<typeof POST>[0],
  );

test('rejects malformed JSON with 400', async () => {
  const res = await post('{ broken');
  assert.equal(res.status, 400);
  assert.match(await res.text(), /invalid JSON/);
});

test('rejects an empty, missing, or non-array items list with 400', async () => {
  assert.equal((await post(JSON.stringify({ items: [] }))).status, 400);
  assert.equal((await post(JSON.stringify({}))).status, 400);
  assert.equal((await post(JSON.stringify({ items: 'nope' }))).status, 400);
  assert.match(await (await post(JSON.stringify({ items: [] }))).text(), /empty print list/);
});

test('rejects a list whose cards resolve to no image with 400', async () => {
  // stub the image-lookup query to find nothing for every slug
  __setTestQueryRunner({ query: async () => ({ rows: [] }) });
  try {
    const res = await post(
      JSON.stringify({ items: [{ slug: 'sv01-001', lang: 'en', qty: 1 }], target: 'pdf' }),
    );
    assert.equal(res.status, 400);
    assert.match(await res.text(), /no resolvable images/);
  } finally {
    __setTestQueryRunner(null);
  }
});
