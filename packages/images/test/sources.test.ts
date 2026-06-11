import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveSources,
  canonicalToPtcgSetId,
  localIdToPtcgNum,
  canonicalToMalieSetId,
  localIdToMalieNum,
  malieImageUrl,
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

test('canonicalToMalieSetId: unpads SV/Mega era like TCGL ids', () => {
  assert.equal(canonicalToMalieSetId('sv01'), 'sv1');
  assert.equal(canonicalToMalieSetId('sv10'), 'sv10');
  assert.equal(canonicalToMalieSetId('me04'), 'me4');
});

test('localIdToMalieNum: 3-digit zero-pad for pure numerics only', () => {
  assert.equal(localIdToMalieNum('4'), '004');
  assert.equal(localIdToMalieNum('004'), '004');
  assert.equal(localIdToMalieNum('100'), '100');
  assert.equal(localIdToMalieNum('TG12'), 'TG12');
});

test('malieImageUrl: verified deterministic std-finish PNG pattern', () => {
  assert.equal(
    malieImageUrl('en', 'sv01', '001'),
    'https://cdn.malie.io/file/malie-io/tcgl/cards/png/en/sv1/sv1_en_001_std.png',
  );
  assert.equal(
    malieImageUrl('fr', 'sv03', '4'),
    'https://cdn.malie.io/file/malie-io/tcgl/cards/png/fr/sv3/sv3_fr_004_std.png',
  );
});

test('resolveSources EN: malie first, then pokemontcg.io, then TCGdex', () => {
  const c = resolveSources({
    setId: 'sv03',
    localId: '004',
    lang: 'en',
    tcgdexImageBase: 'https://assets.tcgdex.net/en/sv/sv03/004',
  });
  assert.equal(c.length, 3);
  assert.equal(c[0]!.origin, 'malie_io');
  assert.equal(c[0]!.url, 'https://cdn.malie.io/file/malie-io/tcgl/cards/png/en/sv3/sv3_en_004_std.png');
  assert.equal(c[1]!.origin, 'pokemontcg_io');
  assert.equal(c[1]!.url, 'https://images.pokemontcg.io/sv3/4_hires.png');
  assert.equal(c[2]!.origin, 'tcgdex_assets');
  assert.ok(c[0]!.qualityRank > c[2]!.qualityRank);
});

test('resolveSources fr/de/it/es: malie 296 upgrade above TCGdex', () => {
  const c = resolveSources({
    setId: 'sv03',
    localId: '004',
    lang: 'fr',
    tcgdexImageBase: 'https://assets.tcgdex.net/fr/sv/sv03/004',
  });
  assert.equal(c.length, 2);
  assert.equal(c[0]!.origin, 'malie_io');
  assert.equal(c[0]!.lang, 'fr');
  assert.equal(c[1]!.origin, 'tcgdex_assets');
  assert.ok(c[0]!.qualityRank > c[1]!.qualityRank);
});

test('resolveSources pt: malie EXCLUDED (pt-BR vs pt-PT), TCGdex only', () => {
  const c = resolveSources({
    setId: 'sv03',
    localId: '004',
    lang: 'pt',
    tcgdexImageBase: 'https://assets.tcgdex.net/pt/sv/sv03/004',
  });
  assert.equal(c.length, 1);
  assert.equal(c[0]!.origin, 'tcgdex_assets');
});

test('resolveSources ja: malie has no native art, TCGdex only', () => {
  const c = resolveSources({
    setId: 'sv03',
    localId: '004',
    lang: 'ja',
    tcgdexImageBase: 'https://assets.tcgdex.net/ja/sv/sv03/004',
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

test('resolveSources fr with --no-en-hires: malie skipped, TCGdex only', () => {
  const c = resolveSources({
    setId: 'sv03',
    localId: '004',
    lang: 'fr',
    tcgdexImageBase: 'https://assets.tcgdex.net/fr/sv/sv03/004',
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
