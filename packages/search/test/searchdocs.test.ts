import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchDocs } from '../src/search.js';
import type { MeiliClient } from '../src/client.js';

interface Captured {
  uid: string;
  params: Record<string, unknown>;
}

/** A fake client that records the search call and returns a canned response. */
function recordingClient(box: { captured?: Captured }): MeiliClient {
  return {
    search: async (uid: string, params: Record<string, unknown>) => {
      box.captured = { uid, params };
      return {
        hits: [{ id: 'c1__ja', name: 'Pikachu' }],
        query: '',
        page: 2,
        hitsPerPage: 24,
        totalHits: 99,
        totalPages: 5,
        processingTimeMs: 3,
      };
    },
  } as unknown as MeiliClient;
}

test('searchDocs: routes to cards_<lang>, passes the request, maps the response', async () => {
  const box: { captured?: Captured } = {};
  const out = await searchDocs(recordingClient(box), {
    lang: 'ja',
    q: 'pika',
    page: 2,
    pageSize: 24,
    set: 'sv01',
    supertype: 'Pokemon',
    promoOnly: true,
  });

  // routing: the index IS the language
  assert.equal(box.captured!.uid, 'cards_ja');
  // request passthrough (buildSearchRequest output reaches the client)
  assert.equal(box.captured!.params.q, 'pika');
  assert.equal(box.captured!.params.page, 2);
  assert.equal(box.captured!.params.hitsPerPage, 24);
  assert.deepEqual(box.captured!.params.filter, [
    'setId = "sv01"',
    'supertype = "Pokemon"',
    'isPromo = true',
  ]);
  assert.equal(box.captured!.params.sort, undefined); // q present -> relevance ranking, no sort

  // response mapping (Meili field -> SearchHits field)
  assert.deepEqual(out.docs, [{ id: 'c1__ja', name: 'Pikachu' }]);
  assert.equal(out.total, 99); // totalHits
  assert.equal(out.page, 2);
  assert.equal(out.pageSize, 24); // hitsPerPage
  assert.equal(out.totalPages, 5);
});

test('searchDocs: browse (no query) sends the deterministic sort + empty filter', async () => {
  const box: { captured?: Captured } = {};
  const out = await searchDocs(recordingClient(box), { lang: 'en' });
  assert.equal(box.captured!.uid, 'cards_en');
  assert.deepEqual(box.captured!.params.filter, []);
  assert.deepEqual(box.captured!.params.sort, ['releaseTs:desc', 'setId:asc', 'collectorNumberNum:asc']);
  assert.equal(out.total, 99); // still maps the canned response
});
