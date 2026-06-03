import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MeiliClient, MeiliError } from '../src/client.js';

interface Call {
  url: string;
  method: string;
  auth: string | null;
  body: unknown;
}

/** Build an injectable fetch stub driven by a per-call handler. */
function stub(handler: (call: Call) => { status?: number; json: unknown }) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const call: Call = {
      url: String(url),
      method: init?.method ?? 'GET',
      auth: headers.get('authorization'),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const { status = 200, json } = handler(call);
    return new Response(JSON.stringify(json), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

test('search() posts to the index endpoint with bearer auth and parses the response', async () => {
  const { fetchImpl, calls } = stub(() => ({
    json: {
      hits: [{ id: 'x' }],
      query: 'pi',
      page: 1,
      hitsPerPage: 48,
      totalHits: 1,
      totalPages: 1,
      processingTimeMs: 1,
    },
  }));
  const client = new MeiliClient({ baseUrl: 'http://meili:7700/', apiKey: 'k', fetchImpl });
  const res = await client.search('cards', { q: 'pi', page: 1, hitsPerPage: 48 });

  assert.equal(res.totalHits, 1);
  assert.equal(calls[0]!.url, 'http://meili:7700/indexes/cards/search'); // trailing slash trimmed
  assert.equal(calls[0]!.method, 'POST');
  assert.equal(calls[0]!.auth, 'Bearer k');
});

test('json() throws MeiliError carrying the API message on non-2xx', async () => {
  const { fetchImpl } = stub(() => ({ status: 400, json: { message: 'attr not filterable' } }));
  const client = new MeiliClient({ baseUrl: 'http://m', apiKey: 'k', fetchImpl });
  await assert.rejects(
    () => client.search('cards', {}),
    (e: unknown) => {
      assert.ok(e instanceof MeiliError);
      assert.equal((e as MeiliError).status, 400);
      assert.match((e as Error).message, /not filterable/);
      return true;
    },
  );
});

test('waitForTask polls until succeeded', async () => {
  let n = 0;
  const { fetchImpl } = stub(() => {
    n += 1;
    return { json: { uid: 7, status: n < 3 ? 'processing' : 'succeeded', error: null } };
  });
  const client = new MeiliClient({ baseUrl: 'http://m', apiKey: 'k', fetchImpl });
  const task = await client.waitForTask(7, { intervalMs: 1 });
  assert.equal(task.status, 'succeeded');
  assert.ok(n >= 3);
});

test('waitForTask throws on a failed task with the engine error message', async () => {
  const { fetchImpl } = stub(() => ({
    json: { uid: 8, status: 'failed', error: { message: 'boom' } },
  }));
  const client = new MeiliClient({ baseUrl: 'http://m', apiKey: 'k', fetchImpl });
  await assert.rejects(() => client.waitForTask(8, { intervalMs: 1 }), /boom/);
});

test('ensureIndex creates the index when GET returns 404, then awaits the task', async () => {
  const seen: string[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const m = init?.method ?? 'GET';
    seen.push(`${m} ${u}`);
    if (m === 'GET' && u.endsWith('/indexes/cards')) {
      return new Response('{}', { status: 404 });
    }
    if (m === 'POST' && u.endsWith('/indexes')) {
      return new Response(
        JSON.stringify({ taskUid: 1, status: 'enqueued', type: 'indexCreation', indexUid: 'cards' }),
        { status: 202, headers: { 'content-type': 'application/json' } },
      );
    }
    if (m === 'GET' && u.includes('/tasks/1')) {
      return new Response(JSON.stringify({ uid: 1, status: 'succeeded', error: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;

  const client = new MeiliClient({ baseUrl: 'http://m', apiKey: 'k', fetchImpl });
  await client.ensureIndex('cards', 'id');
  assert.ok(seen.some((s) => s.startsWith('POST http://m/indexes')));
  assert.ok(seen.some((s) => s.includes('/tasks/1')));
});
