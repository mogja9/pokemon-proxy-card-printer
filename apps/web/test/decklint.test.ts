import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findDuplicateLines, summarizeDuplicates } from '../lib/decklint';

test('finds a card named on two lines and sums the quantity', () => {
  const dups = findDuplicateLines('4 Pikachu SVI 94\n2 Pikachu SVI 94');
  assert.deepEqual(dups, [{ name: 'Pikachu SVI 94', occurrences: 2, totalQty: 6 }]);
});

test('is case- and whitespace-insensitive on the card portion', () => {
  const dups = findDuplicateLines('3 Iono\n1 iono\n2   IONO');
  assert.equal(dups.length, 1);
  assert.equal(dups[0]!.occurrences, 3);
  assert.equal(dups[0]!.totalQty, 6);
});

test('ignores headers, blanks, and non-quantity lines', () => {
  const text = 'Pokémon: 12\n\n4 Pikachu SVI 94\nTotal Cards: 60\n4 Pikachu SVI 94';
  const dups = findDuplicateLines(text);
  assert.equal(dups.length, 1);
  assert.equal(dups[0]!.totalQty, 8);
});

test('returns nothing when every line is unique', () => {
  assert.deepEqual(findDuplicateLines('4 Pikachu SVI 94\n2 Charizard ex OBF 125\n3 Iono'), []);
});

test('preserves first-seen order and spelling across multiple duplicate groups', () => {
  const dups = findDuplicateLines('2 Iono\n4 Pikachu SVI 94\n1 Iono\n1 Pikachu SVI 94');
  assert.deepEqual(
    dups.map((d) => d.name),
    ['Iono', 'Pikachu SVI 94'],
  );
});

test('summarizeDuplicates renders a readable one-liner, empty when none', () => {
  assert.equal(summarizeDuplicates([]), '');
  assert.equal(
    summarizeDuplicates([
      { name: 'Pikachu SVI 94', occurrences: 2, totalQty: 6 },
      { name: 'Iono', occurrences: 3, totalQty: 3 },
    ]),
    'Combined 2 duplicate lines: Pikachu SVI 94 (x6), Iono (x3).',
  );
  assert.equal(
    summarizeDuplicates([{ name: 'Iono', occurrences: 2, totalQty: 4 }]),
    'Combined 1 duplicate line: Iono (x4).',
  );
});
