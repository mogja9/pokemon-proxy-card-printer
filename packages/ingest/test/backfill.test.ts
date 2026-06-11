import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applySetFlags } from '../src/backfill.js';
import type { NormalizedCard } from '../src/types.js';

const card = (p: Partial<NormalizedCard>): NormalizedCard => ({
  sourceId: 'sv1-1',
  localId: '1',
  name: 'Pineco',
  isPromo: false,
  isDigitalOnly: false,
  raw: {},
  ...p,
});

test('applySetFlags: a card in a promo set becomes promo (the --full svp bug)', () => {
  // getCard would have set isPromo=false from the series id 'sv'
  const out = applySetFlags(card({ isPromo: false }), { isPromoSet: true, isDigitalOnly: false });
  assert.equal(out.isPromo, true);
  assert.equal(out.isDigitalOnly, false);
});

test('applySetFlags: a card in a digital-only set becomes digital-only', () => {
  const out = applySetFlags(card({ isDigitalOnly: false }), { isPromoSet: false, isDigitalOnly: true });
  assert.equal(out.isDigitalOnly, true);
});

test('applySetFlags: monotonic - never UNSETS a flag the card already had', () => {
  const out = applySetFlags(card({ isPromo: true, isDigitalOnly: true }), {
    isPromoSet: false,
    isDigitalOnly: false,
  });
  assert.equal(out.isPromo, true);
  assert.equal(out.isDigitalOnly, true);
});

test('applySetFlags: does not mutate the input card', () => {
  const input = card({ isPromo: false });
  applySetFlags(input, { isPromoSet: true, isDigitalOnly: true });
  assert.equal(input.isPromo, false); // original untouched
  assert.equal(input.isDigitalOnly, false);
});
