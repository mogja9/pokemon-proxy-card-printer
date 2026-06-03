import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchRequest, filterValue } from '../src/search.js';

test('lang is always filtered; sort applied only when there is no text query', () => {
  const browse = buildSearchRequest({ lang: 'en' });
  assert.deepEqual(browse.filter, ['lang = "en"']);
  assert.deepEqual(browse.sort, ['releaseTs:desc', 'setId:asc', 'collectorNumberNum:asc']);
  assert.equal(browse.q, '');

  const searched = buildSearchRequest({ lang: 'ja', q: 'pikachu' });
  assert.equal(searched.q, 'pikachu');
  assert.equal(searched.sort, undefined); // relevance ranking wins
  assert.deepEqual(searched.filter, ['lang = "ja"']);
});

test('set/supertype/promo filters compose in order', () => {
  const r = buildSearchRequest({ lang: 'en', set: 'base1', supertype: 'Pokemon', promoOnly: true });
  assert.deepEqual(r.filter, [
    'lang = "en"',
    'setId = "base1"',
    'supertype = "Pokemon"',
    'isPromo = true',
  ]);
});

test('pageSize clamps to [1,120]; page floors at 1; defaults to 48', () => {
  assert.equal(buildSearchRequest({ lang: 'en', pageSize: 9999 }).hitsPerPage, 120);
  assert.equal(buildSearchRequest({ lang: 'en', pageSize: 0 }).hitsPerPage, 1);
  assert.equal(buildSearchRequest({ lang: 'en', page: -5 }).page, 1);
  assert.equal(buildSearchRequest({ lang: 'en' }).hitsPerPage, 48);
});

test('filterValue escapes embedded quotes and backslashes', () => {
  assert.equal(filterValue('ab"c'), '"ab\\"c"');
  assert.equal(filterValue('a\\b'), '"a\\\\b"');
});

test('whitespace-only query is treated as browse (sorted, empty q)', () => {
  const r = buildSearchRequest({ lang: 'en', q: '   ' });
  assert.equal(r.q, '');
  assert.ok(r.sort);
});
