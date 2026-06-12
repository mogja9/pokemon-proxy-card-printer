import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normSupertype,
  groupBySupertype,
  summarizeBySupertype,
  buildDeckExport,
  buildPlainExport,
  buildExport,
  printListTotals,
} from '../lib/printlist';

const items = [
  { qty: 3, name: 'Iono', supertype: 'Trainer' },
  { qty: 4, name: 'Pikachu', supertype: 'Pokemon' },
  { qty: 8, name: 'Lightning Energy', supertype: 'Energy' },
  { qty: 2, name: 'Charizard ex', supertype: 'Pokémon' },
];

test('normSupertype maps Pokemon to the accented label and blanks to Other', () => {
  assert.equal(normSupertype('Pokemon'), 'Pokémon');
  assert.equal(normSupertype('Pokémon'), 'Pokémon');
  assert.equal(normSupertype('Trainer'), 'Trainer');
  assert.equal(normSupertype(null), 'Other');
  assert.equal(normSupertype(undefined), 'Other');
});

test('groupBySupertype orders Pokémon, Trainer, Energy and sums qty', () => {
  const groups = groupBySupertype(items);
  assert.deepEqual(
    groups.map((g) => [g.label, g.count]),
    [
      ['Pokémon', 6], // 4 Pikachu + 2 Charizard (Pokemon + Pokémon merge)
      ['Trainer', 3],
      ['Energy', 8],
    ],
  );
});

test('groupBySupertype keeps unknown supertypes after the canonical three', () => {
  const groups = groupBySupertype([
    { qty: 1, name: 'Mystery', supertype: 'Special' },
    { qty: 5, name: 'Pikachu', supertype: 'Pokemon' },
  ]);
  assert.deepEqual(
    groups.map((g) => g.label),
    ['Pokémon', 'Special'],
  );
});

test('summarizeBySupertype renders a dot-separated one-liner', () => {
  assert.equal(summarizeBySupertype(items), '6 Pokémon · 3 Trainer · 8 Energy');
  assert.equal(summarizeBySupertype([]), '');
});

test('buildDeckExport groups with headers and counts when supertypes exist', () => {
  assert.equal(
    buildDeckExport(items),
    'Pokémon: 6\n4 Pikachu\n2 Charizard ex\n\nTrainer: 3\n3 Iono\n\nEnergy: 8\n8 Lightning Energy',
  );
});

test('buildDeckExport falls back to a flat list when no supertypes are present', () => {
  const flat = [
    { qty: 2, name: 'Card A', supertype: null },
    { qty: 1, name: 'Card B' },
  ];
  assert.equal(buildDeckExport(flat), '2 Card A\n1 Card B');
});

test('buildPlainExport is flat with no headers even when supertypes exist', () => {
  assert.equal(
    buildPlainExport(items),
    '3 Iono\n4 Pikachu\n8 Lightning Energy\n2 Charizard ex',
  );
  assert.equal(buildPlainExport([]), '');
});

test('buildExport dispatches on format', () => {
  assert.equal(buildExport(items, 'grouped'), buildDeckExport(items));
  assert.equal(buildExport(items, 'plain'), buildPlainExport(items));
});

test('printListTotals sums copies and counts distinct rows', () => {
  assert.deepEqual(printListTotals(items), { copies: 17, unique: 4 });
  assert.deepEqual(printListTotals([]), { copies: 0, unique: 0 });
  assert.deepEqual(printListTotals([{ qty: 1, name: 'X' }]), { copies: 1, unique: 1 });
});
