import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deckLineFor } from '../lib/deckline';

test('formats a full line with uppercased set code and number', () => {
  assert.equal(deckLineFor({ name: 'Pikachu', setCode: 'svi', collector: '94' }, 4), '4 Pikachu SVI 94');
});

test('defaults quantity to 1 and floors/clamps invalid quantities', () => {
  assert.equal(deckLineFor({ name: 'Iono', setCode: 'PAF', collector: '237' }), '1 Iono PAF 237');
  assert.equal(deckLineFor({ name: 'Iono', setCode: 'PAF', collector: '237' }, 0), '1 Iono PAF 237');
  assert.equal(deckLineFor({ name: 'Iono', setCode: 'PAF', collector: '237' }, 2.9), '2 Iono PAF 237');
  assert.equal(deckLineFor({ name: 'Iono', setCode: 'PAF', collector: '237' }, NaN), '1 Iono PAF 237');
});

test('falls back to a name-only line when set code or number is missing', () => {
  assert.equal(deckLineFor({ name: "Boss's Orders" }, 2), "2 Boss's Orders");
  assert.equal(deckLineFor({ name: 'Energy', setCode: 'SVI', collector: null }, 8), '8 Energy');
  assert.equal(deckLineFor({ name: 'Energy', setCode: '', collector: '1' }, 8), '8 Energy');
});

test('trims surrounding whitespace on fields', () => {
  assert.equal(deckLineFor({ name: '  Pikachu  ', setCode: ' svi ', collector: ' 94 ' }), '1 Pikachu SVI 94');
});
