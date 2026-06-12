import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchRequest, filterValue } from '../src/search.js';

test('no lang filter (the index is per-lang); sort only when no text query', () => {
  const browse = buildSearchRequest({ lang: 'en' });
  assert.deepEqual(browse.filter, []); // lang is the index, not a filter
  assert.deepEqual(browse.sort, ['releaseTs:desc', 'setId:asc', 'collectorNumberNum:asc']);
  assert.equal(browse.q, '');

  const searched = buildSearchRequest({ lang: 'ja', q: 'pikachu' });
  assert.equal(searched.q, 'pikachu');
  assert.equal(searched.sort, undefined); // relevance ranking wins
  assert.deepEqual(searched.filter, []);
});

test('set/supertype/promo filters compose in order (no lang)', () => {
  const r = buildSearchRequest({ lang: 'en', set: 'base1', supertype: 'Pokemon', promoOnly: true });
  assert.deepEqual(r.filter, ['setId = "base1"', 'supertype = "Pokemon"', 'isPromo = true']);
});

test('pageSize clamps to [1,120]; page floors at 1; defaults to 48', () => {
  assert.equal(buildSearchRequest({ lang: 'en', pageSize: 9999 }).hitsPerPage, 120);
  assert.equal(buildSearchRequest({ lang: 'en', pageSize: 0 }).hitsPerPage, 1);
  assert.equal(buildSearchRequest({ lang: 'en', page: -5 }).page, 1);
  assert.equal(buildSearchRequest({ lang: 'en' }).hitsPerPage, 48);
});

test('page/pageSize coerce to a finite integer (no NaN/Infinity/fraction leaks)', () => {
  // NaN must not propagate to hitsPerPage/page (NaN is not nullish, so ?? kept it)
  assert.equal(buildSearchRequest({ lang: 'en', pageSize: NaN }).hitsPerPage, 48);
  assert.equal(buildSearchRequest({ lang: 'en', page: NaN }).page, 1);
  assert.equal(buildSearchRequest({ lang: 'en', pageSize: Infinity }).hitsPerPage, 48);
  assert.equal(buildSearchRequest({ lang: 'en', page: Infinity }).page, 1);
  // fractional values floor to an integer rather than reaching Meili as a float
  assert.equal(buildSearchRequest({ lang: 'en', pageSize: 48.9 }).hitsPerPage, 48);
  assert.equal(buildSearchRequest({ lang: 'en', page: 2.9 }).page, 2);
  assert.equal(buildSearchRequest({ lang: 'en', page: 3 }).page, 3);
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

test('browse sort: newest (default) / oldest / set, ignored when a query is present', () => {
  assert.deepEqual(buildSearchRequest({ lang: 'en' }).sort, [
    'releaseTs:desc', 'setId:asc', 'collectorNumberNum:asc',
  ]);
  assert.deepEqual(buildSearchRequest({ lang: 'en', sort: 'oldest' }).sort, [
    'releaseTs:asc', 'setId:asc', 'collectorNumberNum:asc',
  ]);
  assert.deepEqual(buildSearchRequest({ lang: 'en', sort: 'set' }).sort, [
    'setId:asc', 'collectorNumberNum:asc',
  ]);
  // a text query -> relevance ranking, sort omitted even if requested
  assert.equal(buildSearchRequest({ lang: 'en', q: 'pika', sort: 'oldest' }).sort, undefined);
});
