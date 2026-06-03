import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveSources,
  canonicalToPtcgSetId,
  localIdToPtcgNum,
} from '../src/sources.js';
import { dpiAtTrim } from '../src/fetch.js';

test('canonicalToPtcgSetId: unpads Mega/SV era, leaves others', () => {
  assert.equal(canonicalToPtcgSetId('sv03'), 'sv3');
  assert.equal(canonicalToPtcgSetId('me04'), 'me4');
  assert.equal(canonicalToPtcgSetId('swsh1'), 'swsh1');
  assert.equal(canonicalToPtcgSetId('base1'), 'base1');
  assert.equal(canonicalToPtcgSetId('sv10'), 'sv10');
});

test('localIdToPtcgNum: strips leading zeros for pure numerics only', () => {
  assert.equal(localIdToPtcgNum('004'), '4');
  assert.equal(localIdToPtcgNum('100'), '100');
  assert.equal(localIdToPtcgNum('TG12'), 'TG12');
});

test('resolveSources EN: pokemontcg.io hi-res first, TCGdex fallback', () => {
  const c = resolveSources({
    setId: 'sv03',
    localId: '004',
    lang: 'en',
    tcgdexImageBase: 'https://assets.tcgdex.net/en/sv/sv03/004',
  });
  assert.equal(c.length, 2);
  assert.equal(c[0]!.origin, 'pokemontcg_io');
  assert.equal(c[0]!.url, 'https://images.pokemontcg.io/sv3/4_hires.png');
  assert.ok(c[0]!.qualityRank > c[1]!.qualityRank);
  assert.equal(c[1]!.origin, 'tcgdex_assets');
  assert.equal(c[1]!.url, 'https://assets.tcgdex.net/en/sv/sv03/004/high.png');
});

test('resolveSources non-EN: TCGdex only', () => {
  const c = resolveSources({
    setId: 'sv03',
    localId: '004',
    lang: 'fr',
    tcgdexImageBase: 'https://assets.tcgdex.net/fr/sv/sv03/004',
  });
  assert.equal(c.length, 1);
  assert.equal(c[0]!.origin, 'tcgdex_assets');
});

test('resolveSources EN with --no-en-hires: TCGdex only', () => {
  const c = resolveSources({
    setId: 'sv03',
    localId: '004',
    lang: 'en',
    tcgdexImageBase: 'https://assets.tcgdex.net/en/sv/sv03/004',
    enHires: false,
  });
  assert.equal(c.length, 1);
  assert.equal(c[0]!.origin, 'tcgdex_assets');
});

test('dpiAtTrim: matches schema (296 for 1024px, 242 for 825px, 350 for 1212px)', () => {
  assert.equal(dpiAtTrim(1024), 295.6);
  assert.equal(dpiAtTrim(825), 238.1);
  assert.equal(dpiAtTrim(1212), 349.8);
});
