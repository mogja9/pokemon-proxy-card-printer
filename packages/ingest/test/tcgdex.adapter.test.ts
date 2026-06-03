import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TcgdexAdapter } from '../src/adapters/tcgdex.js';

// Network-gated: only runs with PPF_RUN_NET_TESTS=1 (npm run test:net) so the
// default unit-test run stays offline and deterministic.
const RUN = process.env.PPF_RUN_NET_TESTS === '1';
const base = process.env.TCGDEX_BASE_URL ?? 'https://api.tcgdex.net/v2';

test('TCGdex live: listSets(en) returns many sets', { skip: !RUN }, async () => {
  const a = new TcgdexAdapter(base, 4);
  const sets = await a.listSets('en');
  assert.ok(sets.length > 100, `expected >100 en sets, got ${sets.length}`);
  assert.ok(sets.some((s) => s.id === 'base1'));
});

test('TCGdex live: getSet(en, sv03) has cards + serie', { skip: !RUN }, async () => {
  const a = new TcgdexAdapter(base, 4);
  const set = await a.getSet('en', 'sv03');
  assert.ok(set, 'sv03 should exist');
  assert.equal(set!.seriesId, 'sv');
  assert.ok(set!.cards.length > 100);
  const first = set!.cards[0]!;
  assert.ok(first.imageBase?.startsWith('https://assets.tcgdex.net/'));
});

test('TCGdex live: Western langs share set IDs; ja does not', { skip: !RUN }, async () => {
  const a = new TcgdexAdapter(base, 4);
  const en = await a.getCard('en', 'sv03-001');
  const fr = await a.getCard('fr', 'sv03-001');
  const ja = await a.getCard('ja', 'sv03-001');
  assert.ok(en, 'en sv03-001 exists');
  assert.ok(fr, 'fr sv03-001 exists (shared Western set id)');
  assert.equal(ja, null, 'ja sv03-001 should NOT exist (different JA set structure)');
});
