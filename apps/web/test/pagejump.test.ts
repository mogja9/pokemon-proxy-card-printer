import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampPage } from '../lib/pagejump';

test('clamps within 1..totalPages', () => {
  assert.equal(clampPage(3, 10), 3);
  assert.equal(clampPage(1, 10), 1);
  assert.equal(clampPage(10, 10), 10);
});

test('snaps out-of-range values to the nearest bound', () => {
  assert.equal(clampPage(0, 10), 1);
  assert.equal(clampPage(-5, 10), 1);
  assert.equal(clampPage(9999, 10), 10);
});

test('tolerates blank, non-numeric, fractional, and non-finite input', () => {
  assert.equal(clampPage('', 10), 1);
  assert.equal(clampPage('abc', 10), 1);
  assert.equal(clampPage('  ', 10), 1);
  assert.equal(clampPage(NaN, 10), 1);
  assert.equal(clampPage(Infinity, 10), 1); // non-finite -> first page
  assert.equal(clampPage('4.9', 10), 4);
  assert.equal(clampPage('7', 10), 7);
});

test('handles degenerate totalPages by pinning to page 1', () => {
  assert.equal(clampPage(5, 1), 1);
  assert.equal(clampPage(5, 0), 1);
  assert.equal(clampPage(5, NaN), 1);
});
