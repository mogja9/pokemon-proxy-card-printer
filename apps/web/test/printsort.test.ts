import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortPrintList, isPrintSort } from '../lib/printsort';

const rows = [
  { name: 'Pikachu', lang: 'en', qty: 4 },
  { name: 'Charizard ex', lang: 'en', qty: 2 },
  { name: 'Iono', lang: 'en', qty: 3 },
  { name: 'Iono', lang: 'ja', qty: 3 },
];

test('added mode preserves input order and does not mutate the source', () => {
  const out = sortPrintList(rows, 'added');
  assert.deepEqual(out.map((r) => r.name), ['Pikachu', 'Charizard ex', 'Iono', 'Iono']);
  assert.notEqual(out, rows); // new array
  assert.equal(rows[0]!.name, 'Pikachu'); // source untouched
});

test('name mode sorts alphabetically, tie-broken by lang', () => {
  const out = sortPrintList(rows, 'name');
  assert.deepEqual(
    out.map((r) => `${r.name}/${r.lang}`),
    ['Charizard ex/en', 'Iono/en', 'Iono/ja', 'Pikachu/en'],
  );
});

test('qty mode sorts high to low, tie-broken by name then lang', () => {
  const out = sortPrintList(rows, 'qty');
  assert.deepEqual(
    out.map((r) => `${r.name}/${r.lang}:${r.qty}`),
    ['Pikachu/en:4', 'Iono/en:3', 'Iono/ja:3', 'Charizard ex/en:2'],
  );
});

test('sorting an empty list is a no-op', () => {
  assert.deepEqual(sortPrintList([], 'name'), []);
});

test('isPrintSort guards the stored/select value', () => {
  assert.equal(isPrintSort('name'), true);
  assert.equal(isPrintSort('qty'), true);
  assert.equal(isPrintSort('added'), true);
  assert.equal(isPrintSort('bogus'), false);
  assert.equal(isPrintSort(undefined), false);
});
