import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchImageBytes } from '../src/fetch.js';

// Use a binary body so Response does NOT auto-set content-type (a string body
// would force text/plain and mask the image/png default path).
const fakeFetch = (status: number, body = 'IMG', contentType?: string): typeof fetch =>
  (async () =>
    new Response(status === 404 || status >= 500 ? null : new TextEncoder().encode(body), {
      status,
      headers: contentType ? { 'content-type': contentType } : {},
    })) as unknown as typeof fetch;

test('fetchImageBytes: 200 -> bytes + content-type', async () => {
  const r = await fetchImageBytes('http://x/a.jpg', { fetchImpl: fakeFetch(200, 'hello', 'image/jpeg') });
  assert.ok(r);
  assert.equal(r!.bytes.toString(), 'hello');
  assert.equal(r!.contentType, 'image/jpeg');
});

test('fetchImageBytes: 200 with no content-type header -> defaults to image/png', async () => {
  const r = await fetchImageBytes('http://x/a', { fetchImpl: fakeFetch(200, 'png-bytes') });
  assert.equal(r!.contentType, 'image/png');
});

test('fetchImageBytes: 404 -> null (terminal, drives candidate fallthrough)', async () => {
  const r = await fetchImageBytes('http://x/missing', { fetchImpl: fakeFetch(404) });
  assert.equal(r, null);
});

test('fetchImageBytes: non-2xx (500) -> throws', async () => {
  await assert.rejects(
    () => fetchImageBytes('http://x/boom', { fetchImpl: fakeFetch(500) }),
    /image fetch 500/,
  );
});

test('fetchImageBytes: a network-level fetch rejection propagates', async () => {
  const dead = (async () => {
    throw new Error('ECONNREFUSED');
  }) as unknown as typeof fetch;
  await assert.rejects(() => fetchImageBytes('http://x/down', { fetchImpl: dead }), /ECONNREFUSED/);
});
