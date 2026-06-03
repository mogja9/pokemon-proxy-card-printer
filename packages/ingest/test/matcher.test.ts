import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchSet, nameSimilarity, type CanonicalSet } from '../src/matcher.js';

const CANON: CanonicalSet[] = [
  {
    setId: 'sv03',
    name: 'Obsidian Flames',
    ptcgCode: 'OBF',
    releaseDate: '2023-08-11',
    printedTotal: 197,
    total: 230,
    seriesId: 'sv',
  },
  {
    setId: 'me04',
    name: 'Chaos Rising',
    releaseDate: '2026-05-22',
    printedTotal: 180,
    total: 210,
    seriesId: 'me',
  },
];

test('matchSet: ptcgoCode exact -> confidence 1.0', () => {
  const m = matchSet({ id: 'sv3', name: 'Obsidian Flames', ptcgoCode: 'OBF' }, CANON);
  assert.equal(m?.canonicalSetId, 'sv03');
  assert.equal(m?.rule, 'ptcgoCode');
  assert.equal(m?.confidence, 1.0);
});

test('matchSet: Mega-era alias (me4 -> me04) without ptcgoCode', () => {
  const m = matchSet({ id: 'me4', name: 'Chaos Rising' }, CANON);
  assert.equal(m?.canonicalSetId, 'me04');
  assert.equal(m?.rule, 'alias');
});

test('matchSet: date + printedTotal fallback', () => {
  const m = matchSet(
    { id: 'unknown', name: 'Obsidian Flames', releaseDate: '2023/08/11', printedTotal: 197 },
    CANON,
  );
  assert.equal(m?.canonicalSetId, 'sv03');
  assert.equal(m?.rule, 'date+printedTotal');
});

test('matchSet: no match returns null', () => {
  const m = matchSet({ id: 'zzz', name: 'Totally Unrelated Set' }, CANON);
  assert.equal(m, null);
});

test('nameSimilarity: identical=1, disjoint low', () => {
  assert.equal(nameSimilarity('Obsidian Flames', 'Obsidian Flames'), 1);
  assert.ok(nameSimilarity('Obsidian Flames', 'Chaos Rising') < 0.3);
});
