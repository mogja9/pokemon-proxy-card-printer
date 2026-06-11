import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MPC_BRACKETS,
  MPC_MAX_BRACKET,
  mpcBracket,
  exceedsMpcCapacity,
} from '../src/mpc.js';

test('mpcBracket: smallest bracket >= qty', () => {
  assert.equal(mpcBracket(1), 18); // tiny order -> first bracket
  assert.equal(mpcBracket(18), 18); // exact boundary
  assert.equal(mpcBracket(19), 36); // just over -> next
  assert.equal(mpcBracket(60), 72);
});

test('mpcBracket: the documented 235..396 overshoot gap', () => {
  // no tier between 234 and 396, so 235 cards must buy a 396 bracket
  assert.equal(mpcBracket(234), 234);
  assert.equal(mpcBracket(235), 396);
  assert.equal(mpcBracket(396), 396);
});

test('mpcBracket: clamps to the max bracket past capacity', () => {
  assert.equal(mpcBracket(612), 612);
  assert.equal(mpcBracket(700), MPC_MAX_BRACKET); // best-effort clamp
  assert.equal(MPC_MAX_BRACKET, 612);
});

test('exceedsMpcCapacity: true only past the max bracket', () => {
  assert.equal(exceedsMpcCapacity(612), false); // exactly fits the top bracket
  assert.equal(exceedsMpcCapacity(613), true); // bracket would be < qty -> split
  assert.equal(exceedsMpcCapacity(0), false);
  // brackets are strictly ascending (ladder integrity)
  for (let i = 1; i < MPC_BRACKETS.length; i++) {
    assert.ok(MPC_BRACKETS[i]! > MPC_BRACKETS[i - 1]!);
  }
});
