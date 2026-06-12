import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageRange, formatPageRange } from '../lib/pagerange';

test('first page range', () => {
  assert.deepEqual(pageRange(1, 48, 1234), { from: 1, to: 48, total: 1234 });
});

test('middle page range', () => {
  assert.deepEqual(pageRange(3, 48, 1234), { from: 97, to: 144, total: 1234 });
});

test('last partial page clamps to total', () => {
  assert.deepEqual(pageRange(26, 48, 1234), { from: 1201, to: 1234, total: 1234 });
});

test('total fits in one page', () => {
  assert.deepEqual(pageRange(1, 48, 10), { from: 1, to: 10, total: 10 });
});

test('empty result', () => {
  assert.deepEqual(pageRange(1, 48, 0), { from: 0, to: 0, total: 0 });
});

test('past-the-end page never reads backwards', () => {
  const r = pageRange(5, 48, 10); // page 5 of a 10-card single-page set
  assert.ok(r.from <= r.to, `from ${r.from} should be <= to ${r.to}`);
  assert.equal(r.total, 10);
});

test('formatPageRange: multi-page slice', () => {
  assert.equal(formatPageRange(pageRange(3, 48, 1234)), 'Showing 97-144 of 1,234');
});

test('formatPageRange: single full page collapses to a plain count', () => {
  assert.equal(formatPageRange(pageRange(1, 48, 10)), '10 cards');
  assert.equal(formatPageRange(pageRange(1, 48, 1)), '1 card');
});

test('formatPageRange: empty', () => {
  assert.equal(formatPageRange(pageRange(1, 48, 0)), 'No cards');
});
