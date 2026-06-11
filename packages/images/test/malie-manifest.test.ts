import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseIndex,
  parseSetCards,
  malieLocale,
  MalieManifest,
  applyMalieManifest,
  type FetchJson,
} from '../src/malie-manifest.js';

const URL_001 = 'https://cdn.malie.io/file/malie-io/tcgl/cards/png/en/sv1/sv1_en_001_std.png';
const URL_100 = 'https://cdn.malie.io/file/malie-io/tcgl/cards/png/en/sv1/sv1_en_100_std.png';

// Manifest shaped like the real export (only sv1/me1 present; base1 absent).
const INDEX_JSON = {
  'en-US': {
    sv1: { path: 'v0.1.9.12/sv1.en-US.json', name: 'Scarlet & Violet', num: 444, abbr: 'SVI' },
    me1: { path: 'v0.1.9.12/me1.en-US.json', name: 'Mega Evolution', num: 310, abbr: 'MEG' },
  },
  'fr-FR': { sv1: { path: 'v0.1.9.12/sv1.fr-FR.json' } },
};

const SET_JSON = [
  { collector_number: { numerator: '001' }, images: { tcgl: { png: { front: URL_001 } } } },
  { collector_number: { numerator: '100' }, images: { tcgl: { png: { front: URL_100 } } } },
  // foil variant: same collector number, same std PNG -> deduped
  { collector_number: { numerator: '100' }, images: { tcgl: { png: { front: URL_100 } } } },
];

function fakeFetch(counter?: { n: number }): FetchJson {
  return async (url: string) => {
    if (counter) counter.n += 1;
    if (url.endsWith('/index.json')) return INDEX_JSON;
    if (url.includes('sv1.en-US.json')) return SET_JSON;
    throw new Error(`404 ${url}`);
  };
}

test('parseIndex: set->path for the locale only', () => {
  const idx = parseIndex(INDEX_JSON, 'en-US');
  assert.equal(idx.get('sv1'), 'v0.1.9.12/sv1.en-US.json');
  assert.equal(idx.get('me1'), 'v0.1.9.12/me1.en-US.json');
  assert.equal(idx.size, 2);
  assert.equal(parseIndex(INDEX_JSON, 'ja-JP').size, 0); // unknown locale -> empty
});

test('parseSetCards: numerator -> png.front, dups deduped', () => {
  const cards = parseSetCards(SET_JSON);
  assert.equal(cards.get('001'), URL_001);
  assert.equal(cards.get('100'), URL_100);
  assert.equal(cards.size, 2); // the foil dup collapsed
  assert.equal(parseSetCards('not-an-array').size, 0);
});

test('malieLocale: Western langs only', () => {
  assert.equal(malieLocale('en'), 'en-US');
  assert.equal(malieLocale('fr'), 'fr-FR');
  assert.equal(malieLocale('ja'), null);
  assert.equal(malieLocale('pt'), null); // excluded (pt-BR vs pt-PT)
});

test('lookup found: maps padded setId, zero-pads number', async () => {
  const m = new MalieManifest({ fetchJson: fakeFetch() });
  // 'sv01' -> 'sv1' via canonicalToMalieSetId; '1' -> '001'
  assert.deepEqual(await m.lookup('en', 'sv01', '1'), { status: 'found', url: URL_001 });
  assert.deepEqual(await m.lookup('en', 'sv01', '100'), { status: 'found', url: URL_100 });
});

test('lookup absent: set not on malie, or card not in set, or non-Western lang', async () => {
  const m = new MalieManifest({ fetchJson: fakeFetch() });
  assert.deepEqual(await m.lookup('en', 'base1', '001'), { status: 'absent' }); // set absent
  assert.deepEqual(await m.lookup('en', 'sv01', '999'), { status: 'absent' }); // card absent
  assert.deepEqual(await m.lookup('ja', 'sv01', '001'), { status: 'absent' }); // no JA on malie
});

test('lookup unknown when the manifest cannot be fetched (keep fallback)', async () => {
  const m = new MalieManifest({
    fetchJson: async () => {
      throw new Error('network down');
    },
  });
  assert.deepEqual(await m.lookup('en', 'sv01', '001'), { status: 'unknown' });
});

test('caching: index fetched once, each set fetched once', async () => {
  const counter = { n: 0 };
  const m = new MalieManifest({ fetchJson: fakeFetch(counter) });
  await m.lookup('en', 'sv01', '001');
  await m.lookup('en', 'sv01', '100');
  await m.lookup('en', 'sv01', '999');
  assert.equal(counter.n, 2); // 1 index + 1 set, despite 3 lookups
});

test('applyMalieManifest: found replaces, absent drops, unknown keeps, others pass', async () => {
  const resolver = {
    lookup: async (_l: string, _s: string, id: string) => {
      if (id === 'found') return { status: 'found', url: URL_001 } as const;
      if (id === 'absent') return { status: 'absent' } as const;
      return { status: 'unknown' } as const;
    },
  };
  const malie = (url: string) => ({ origin: 'malie_io', lang: 'en', url });
  const tcgdex = { origin: 'tcgdex_assets', lang: 'en', url: 'tcgdex-url' };

  const found = await applyMalieManifest([malie('blind'), tcgdex], 'sv1', 'found', resolver);
  assert.deepEqual(found, [{ origin: 'malie_io', lang: 'en', url: URL_001 }, tcgdex]);

  const absent = await applyMalieManifest([malie('blind'), tcgdex], 'sv1', 'absent', resolver);
  assert.deepEqual(absent, [tcgdex]); // malie dropped, TCGdex remains

  const unknown = await applyMalieManifest([malie('blind'), tcgdex], 'sv1', 'unknown', resolver);
  assert.deepEqual(unknown, [malie('blind'), tcgdex]); // malie kept as-is
});
