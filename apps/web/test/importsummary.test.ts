import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importPreviewSummary, importAddedSummary } from '../lib/importsummary';

test('importPreviewSummary pluralizes cards and lines', () => {
  assert.equal(importPreviewSummary(58, 18, 0), 'Ready to add 58 cards from 18 lines.');
  assert.equal(importPreviewSummary(1, 1, 0), 'Ready to add 1 card from 1 line.');
});

test('importPreviewSummary appends the unmatched-lines note when present', () => {
  assert.equal(
    importPreviewSummary(58, 18, 2),
    'Ready to add 58 cards from 18 lines. 2 lines will not match.',
  );
  assert.equal(
    importPreviewSummary(4, 1, 1),
    'Ready to add 4 cards from 1 line. 1 line will not match.',
  );
});

test('importAddedSummary matches the confirm wording with pluralization', () => {
  assert.equal(importAddedSummary(58, 18), 'Added 58 cards from 18 lines.');
  assert.equal(importAddedSummary(1, 1), 'Added 1 card from 1 line.');
});
