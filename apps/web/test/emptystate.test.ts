import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyStateSuggestions } from '../lib/emptystate';

test('suggests running ingest when no filters are active', () => {
  assert.deepEqual(emptyStateSuggestions({}), [
    'No cards are loaded yet - run the ingest to populate the catalog.',
  ]);
  // lang 'en' alone is not a narrowing filter
  assert.deepEqual(emptyStateSuggestions({ lang: 'en' }), [
    'No cards are loaded yet - run the ingest to populate the catalog.',
  ]);
});

test('suggests loosening each active filter, narrowest first', () => {
  const s = emptyStateSuggestions({ q: 'Pikchu', set: 'sv1', supertype: 'Trainer', promoOnly: true, lang: 'ja' });
  assert.equal(s.length, 5);
  assert.match(s[0]!, /spelling of "Pikchu"/);
  assert.match(s[1]!, /set filter/);
  assert.match(s[2]!, /Trainer type filter/);
  assert.match(s[3]!, /Uncheck Promo/);
  assert.match(s[4]!, /English/);
});

test('only includes suggestions for the filters that are set', () => {
  assert.deepEqual(emptyStateSuggestions({ promoOnly: true }), [
    'Uncheck Promo to include regular cards.',
  ]);
  const langOnly = emptyStateSuggestions({ lang: 'fr' });
  assert.equal(langOnly.length, 1);
  assert.match(langOnly[0]!, /English/);
});
