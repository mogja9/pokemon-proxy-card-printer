import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugifyDeckName, deckFileName } from '../lib/filename';

test('slugifies a deck name to lowercase dash-separated', () => {
  assert.equal(slugifyDeckName('My Lugia Deck'), 'my-lugia-deck');
  assert.equal(slugifyDeckName('Charizard ex'), 'charizard-ex');
});

test('strips diacritics and punctuation', () => {
  assert.equal(slugifyDeckName('Café Lugia!!'), 'cafe-lugia');
  assert.equal(slugifyDeckName('Gardevoir / Zacian'), 'gardevoir-zacian');
});

test('falls back to proxies for empty or symbol-only names', () => {
  assert.equal(slugifyDeckName(''), 'proxies');
  assert.equal(slugifyDeckName('   '), 'proxies');
  assert.equal(slugifyDeckName('---'), 'proxies');
  assert.equal(slugifyDeckName('!!!'), 'proxies');
});

test('trims leading/trailing dashes and caps length to 60 with no trailing dash', () => {
  assert.equal(slugifyDeckName('  spaced out  '), 'spaced-out');
  const long = slugifyDeckName('a'.repeat(80));
  assert.equal(long.length, 60);
  assert.ok(!long.endsWith('-'));
  // a slice landing mid-dash should not leave a trailing dash
  assert.ok(!slugifyDeckName('x '.repeat(40)).endsWith('-'));
});

test('deckFileName appends the right extension per target', () => {
  assert.equal(deckFileName('My Deck', 'pdf'), 'my-deck.pdf');
  assert.equal(deckFileName('My Deck', 'mpc'), 'my-deck-mpc.zip');
  assert.equal(deckFileName('', 'pdf'), 'proxies.pdf');
  assert.equal(deckFileName('', 'mpc'), 'proxies-mpc.zip');
});
