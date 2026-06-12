import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter, fetchJson, HttpError, type RateLimiterClock } from '../src/http.js';

/** A fetch stub returning the queued responses in order; records the call count. */
function fetchSeq(responses: Response[]): { fetchImpl: typeof fetch; calls: () => number } {
  let i = 0;
  const fetchImpl = (async () => {
    const r = responses[Math.min(i, responses.length - 1)]!;
    i += 1;
    return r;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls: () => i };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const noBackoff = async () => {};

/** A controllable clock: sleeping advances virtual time and records the wait. */
function fakeClock(start = 1_000_000): {
  clock: RateLimiterClock;
  sleeps: number[];
  advance: (ms: number) => void;
} {
  let t = start;
  const sleeps: number[] = [];
  return {
    clock: {
      now: () => t,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        t += ms;
      },
    },
    sleeps,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

test('RateLimiter: first acquire is free, then spaced by 1000/rps', async () => {
  const { clock, sleeps } = fakeClock();
  const rl = new RateLimiter(4, clock); // 250ms min interval
  await rl.acquire();
  await rl.acquire();
  await rl.acquire();
  assert.deepEqual(sleeps, [250, 250]); // 1st free, then each spaced 250ms
});

test('RateLimiter: rps<=0 disables limiting (never sleeps)', async () => {
  const { clock, sleeps } = fakeClock();
  const rl = new RateLimiter(0, clock);
  await rl.acquire();
  await rl.acquire();
  assert.deepEqual(sleeps, []);
});

test('RateLimiter: no sleep when enough wall time already elapsed', async () => {
  const c = fakeClock();
  const rl = new RateLimiter(2, c.clock); // 500ms interval
  await rl.acquire(); // free
  c.advance(600); // 600ms passes on its own (> 500ms interval)
  await rl.acquire(); // already past the interval -> no wait
  assert.deepEqual(c.sleeps, []);
});

test('RateLimiter: serializes concurrent acquires, still spaced', async () => {
  const { clock, sleeps } = fakeClock();
  const rl = new RateLimiter(10, clock); // 100ms interval
  await Promise.all([rl.acquire(), rl.acquire(), rl.acquire()]);
  assert.deepEqual(sleeps, [100, 100]); // chain serializes; 1st free, 2nd+3rd spaced
});

test('fetchJson: returns parsed body on 200', async () => {
  const { fetchImpl, calls } = fetchSeq([json({ ok: 1 })]);
  const out = await fetchJson<{ ok: number }>('http://x', { fetchImpl, sleepImpl: noBackoff });
  assert.deepEqual(out, { ok: 1 });
  assert.equal(calls(), 1);
});

test('fetchJson: 404 is terminal and returns null (no retry)', async () => {
  const { fetchImpl, calls } = fetchSeq([new Response(null, { status: 404 })]);
  const out = await fetchJson('http://x', { fetchImpl, sleepImpl: noBackoff, retries: 3 });
  assert.equal(out, null);
  assert.equal(calls(), 1); // not retried
});

test('fetchJson: 4xx (non-429) is terminal and throws without retry', async () => {
  const { fetchImpl, calls } = fetchSeq([new Response('bad', { status: 400 })]);
  await assert.rejects(
    fetchJson('http://x', { fetchImpl, sleepImpl: noBackoff, retries: 3 }),
    (e) => e instanceof HttpError && e.status === 400,
  );
  assert.equal(calls(), 1); // not retried
});

test('fetchJson: retries on 429 then succeeds', async () => {
  const { fetchImpl, calls } = fetchSeq([new Response('slow', { status: 429 }), json({ ok: 1 })]);
  const out = await fetchJson<{ ok: number }>('http://x', { fetchImpl, sleepImpl: noBackoff });
  assert.deepEqual(out, { ok: 1 });
  assert.equal(calls(), 2);
});

test('fetchJson: exhausts retries on 5xx and throws HttpError, attempts = retries+1', async () => {
  const { fetchImpl, calls } = fetchSeq([new Response('boom', { status: 503 })]);
  const backoffs: number[] = [];
  await assert.rejects(
    fetchJson('http://x', {
      fetchImpl,
      retries: 2,
      sleepImpl: async (ms) => {
        backoffs.push(ms);
      },
    }),
    (e) => e instanceof HttpError && e.status === 503,
  );
  assert.equal(calls(), 3); // retries:2 -> 3 total attempts
  assert.deepEqual(backoffs, [500, 1000]); // exponential backoff between attempts
});

test('fetchJson: retries on network error then succeeds', async () => {
  let i = 0;
  const fetchImpl = (async () => {
    i += 1;
    if (i === 1) throw new Error('ECONNRESET');
    return json({ ok: 1 });
  }) as unknown as typeof fetch;
  const out = await fetchJson<{ ok: number }>('http://x', { fetchImpl, sleepImpl: noBackoff });
  assert.deepEqual(out, { ok: 1 });
  assert.equal(i, 2);
});
