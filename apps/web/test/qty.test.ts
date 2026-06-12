import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampQty, stepQty, QTY_MAX } from '../lib/qty';

test('clampQty floors and bounds to [0,999]', () => {
  assert.equal(clampQty(5), 5);
  assert.equal(clampQty(0), 0);
  assert.equal(clampQty(-3), 0);
  assert.equal(clampQty(9999), QTY_MAX);
  assert.equal(clampQty(4.9), 4);
});

test('clampQty collapses non-finite input to 0', () => {
  assert.equal(clampQty(NaN), 0);
  // floor(Infinity) is Infinity, which is not finite -> QTY_MIN
  assert.equal(clampQty(Number.POSITIVE_INFINITY), 0);
  assert.equal(clampQty(Number.NEGATIVE_INFINITY), 0);
});

test('stepQty increments and decrements within bounds', () => {
  assert.equal(stepQty(3, 1), 4);
  assert.equal(stepQty(3, -1), 2);
  assert.equal(stepQty(1, -1), 0); // 0 means remove
  assert.equal(stepQty(0, -1), 0); // cannot go negative
  assert.equal(stepQty(QTY_MAX, 1), QTY_MAX); // cannot exceed max
});

test('stepQty clamps a dirty current value before stepping', () => {
  assert.equal(stepQty(4.9, 1), 5); // current floored to 4, then +1
  assert.equal(stepQty(-10, 1), 1); // current clamped to 0, then +1
});
