import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDeckList } from '../src/deck.js';

test('parseDeckList: qty + name + setCode + number', () => {
  const out = parseDeckList('4 Pikachu SVI 94');
  assert.deepEqual(out, [{ qty: 4, name: 'Pikachu', setCode: 'SVI', number: '94' }]);
});

test('parseDeckList: multi-word names keep everything before set code', () => {
  assert.deepEqual(parseDeckList("2 Boss's Orders PAL 172"), [
    { qty: 2, name: "Boss's Orders", setCode: 'PAL', number: '172' },
  ]);
  assert.deepEqual(parseDeckList('1 Iron Valiant ex PAR 89'), [
    { qty: 1, name: 'Iron Valiant ex', setCode: 'PAR', number: '89' },
  ]);
});

test('parseDeckList: hyphenated set codes + alnum numbers', () => {
  assert.deepEqual(parseDeckList('2 Poke Ball P-A 5'), [
    { qty: 2, name: 'Poke Ball', setCode: 'P-A', number: '5' },
  ]);
  assert.deepEqual(parseDeckList('1 Radiant Greninja ASR TG12'), [
    { qty: 1, name: 'Radiant Greninja', setCode: 'ASR', number: 'TG12' },
  ]);
});

test('parseDeckList: name-only lines (Trainer/Energy) have no set/number', () => {
  assert.deepEqual(parseDeckList('3 Professor Turo’s Scenario'), [
    { qty: 3, name: 'Professor Turo’s Scenario' },
  ]);
  assert.deepEqual(parseDeckList('4 Iono'), [{ qty: 4, name: 'Iono' }]);
  // "Lightning Energy" - two words, no trailing set/number -> name only
  assert.deepEqual(parseDeckList('8 Lightning Energy'), [{ qty: 8, name: 'Lightning Energy' }]);
});

test('parseDeckList: skips headers, totals, blanks; supports the "2x" form', () => {
  const deck = `Pokémon: 3
4 Pikachu SVI 94
2x Charizard ex OBF 125

Trainer: 1
3 Professor's Research SVI 189

Energy: 1
8 Lightning Energy

Total Cards: 18`;
  const out = parseDeckList(deck);
  assert.deepEqual(out, [
    { qty: 4, name: 'Pikachu', setCode: 'SVI', number: '94' },
    { qty: 2, name: 'Charizard ex', setCode: 'OBF', number: '125' },
    { qty: 3, name: "Professor's Research", setCode: 'SVI', number: '189' },
    { qty: 8, name: 'Lightning Energy' },
  ]);
});

test('parseDeckList: ignores zero/garbage qty and stray non-card lines', () => {
  assert.deepEqual(parseDeckList('0 Pikachu SVI 94'), []); // qty 0 dropped
  assert.deepEqual(parseDeckList('My Deck Title'), []); // no leading qty -> skipped
  assert.deepEqual(parseDeckList(''), []);
});
