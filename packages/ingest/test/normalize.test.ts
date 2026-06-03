import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeCollectorNumber,
  parseCollector,
  normalizeForeignSetId,
} from '../src/normalize.js';

test('normalizeCollectorNumber: strips leading/after-separator zeros only', () => {
  assert.equal(normalizeCollectorNumber('001'), '1');
  assert.equal(normalizeCollectorNumber('TG 12'), 'tg12');
  assert.equal(normalizeCollectorNumber('GG01'), 'gg1');
  assert.equal(normalizeCollectorNumber('SV-P-001'), 'sv-p-1');
  assert.equal(normalizeCollectorNumber('010'), '10');
  assert.equal(normalizeCollectorNumber('0010'), '10');
  assert.equal(normalizeCollectorNumber('SWSH001'), 'swsh1');
  assert.equal(normalizeCollectorNumber('25'), '25');
});

test('normalizeCollectorNumber: KEEPS interior zeros (the 100->10 collision fix)', () => {
  assert.equal(normalizeCollectorNumber('100'), '100');
  assert.equal(normalizeCollectorNumber('200'), '200');
  assert.equal(normalizeCollectorNumber('105'), '105');
  // the critical invariant: '10' and '100' must NOT collide
  assert.notEqual(normalizeCollectorNumber('10'), normalizeCollectorNumber('100'));
});

test('parseCollector: prefix + numeric extraction for natural sort', () => {
  assert.deepEqual(parseCollector('001'), { prefix: '', num: 1 });
  assert.deepEqual(parseCollector('TG12'), { prefix: 'TG', num: 12 });
  assert.deepEqual(parseCollector('GG70'), { prefix: 'GG', num: 70 });
  assert.deepEqual(parseCollector('SWSH001'), { prefix: 'SWSH', num: 1 });
  assert.deepEqual(parseCollector('H'), { prefix: 'H', num: null });
});

test('normalizeForeignSetId: Mega-era padding, not blind zero-pad', () => {
  assert.equal(normalizeForeignSetId('pokemontcg_io', 'me4'), 'me04');
  assert.equal(normalizeForeignSetId('pokemontcg_io', 'me2pt5'), 'me02.5');
  assert.equal(normalizeForeignSetId('pokemontcg_io', 'sv3'), 'sv03');
  assert.equal(normalizeForeignSetId('pokemontcg_io', 'swsh1'), 'swsh1'); // unchanged
  assert.equal(normalizeForeignSetId('pokemontcg_io', 'base1'), 'base1'); // unchanged
});
