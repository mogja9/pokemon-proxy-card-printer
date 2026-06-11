import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter, type RateLimiterClock } from '../src/http.js';

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
