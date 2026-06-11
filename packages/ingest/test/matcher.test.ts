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

test('matchSet: rule 3 - date + total within +-3 + name similarity -> 0.85', () => {
  // total 232 vs sv03's 230 (diff 2); no ptcgoCode/alias/printedTotal so rule 3 is reached
  const m = matchSet(
    { id: 'xyz', name: 'Obsidian Flames', releaseDate: '2023-08-11', total: 232 },
    CANON,
  );
  assert.equal(m?.canonicalSetId, 'sv03');
  assert.equal(m?.rule, 'date+total+name');
  assert.equal(m?.confidence, 0.85);
});

test('matchSet: rule 3 total diff > 3 falls through to rule 4 (name+series, 0.7)', () => {
  // total 234 is 4 from 230 -> rule 3 rejects; name still matches sv03 (same/absent series)
  const m = matchSet(
    { id: 'xyz', name: 'Obsidian Flames', releaseDate: '2023-08-11', total: 234 },
    CANON,
  );
  assert.equal(m?.canonicalSetId, 'sv03');
  assert.equal(m?.rule, 'name+series');
  assert.equal(m?.confidence, 0.7);
});

test('matchSet: rule 4 - name + series only (no date), case-insensitive', () => {
  const m = matchSet({ id: 'xyz', name: 'obsidian flames', seriesId: 'sv' }, CANON);
  assert.equal(m?.canonicalSetId, 'sv03');
  assert.equal(m?.rule, 'name+series');
  assert.equal(m?.confidence, 0.7);
});

test('matchSet: rule 4 respects a series mismatch -> null', () => {
  // name matches sv03 but the series 'me' conflicts -> sv03 skipped; me04 name differs -> null
  const m = matchSet({ id: 'xyz', name: 'Obsidian Flames', seriesId: 'me' }, CANON);
  assert.equal(m, null);
});

test('nameSimilarity: empty / short / CJK edges', () => {
  assert.equal(nameSimilarity('', ''), 1); // both empty -> 1
  assert.equal(nameSimilarity('a', 'a'), 1); // short identical
  assert.equal(nameSimilarity('a', 'b'), 0); // short different
  assert.ok(nameSimilarity('Obsidian Flames!', 'obsidian flames') > 0.95); // case + punctuation insensitive
  // KNOWN edge: CJK-only names normalize to '' so two compare as identical. Harmless in
  // matchSet because the foreign (pokemontcg.io) name is always Latin -> the cross case is 0.
  assert.equal(nameSimilarity('ポケモン', 'ポケモン'), 1);
  assert.equal(nameSimilarity('ポケモン', 'Charizard'), 0);
});
