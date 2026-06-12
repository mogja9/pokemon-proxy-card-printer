import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeInto, type CartItem } from '../lib/cart';

const it = (slug: string, lang: string, name = slug): Omit<CartItem, 'qty'> => ({
  slug,
  lang,
  name,
  imageUrl: null,
  supertype: null,
});

test('appends a new item with the given quantity', () => {
  const cur: CartItem[] = [];
  mergeInto(cur, it('sv01-094', 'en'), 4);
  assert.deepEqual(
    cur.map((x) => [x.slug, x.lang, x.qty]),
    [['sv01-094', 'en', 4]],
  );
});

test('same slug+lang merges and sums quantity (the import-dedup invariant)', () => {
  const cur: CartItem[] = [];
  mergeInto(cur, it('sv01-094', 'en'), 4);
  mergeInto(cur, it('sv01-094', 'en'), 2);
  assert.equal(cur.length, 1);
  assert.equal(cur[0]!.qty, 6);
});

test('same slug but different lang stays a separate row', () => {
  const cur: CartItem[] = [];
  mergeInto(cur, it('sv01-094', 'en'), 1);
  mergeInto(cur, it('sv01-094', 'ja'), 3);
  assert.deepEqual(
    cur.map((x) => [x.lang, x.qty]),
    [
      ['en', 1],
      ['ja', 3],
    ],
  );
});

test('insertion order is preserved across merges', () => {
  const cur: CartItem[] = [];
  mergeInto(cur, it('a', 'en'), 1);
  mergeInto(cur, it('b', 'en'), 1);
  mergeInto(cur, it('a', 'en'), 1); // merges into the first row, does not reorder
  mergeInto(cur, it('c', 'en'), 1);
  assert.deepEqual(
    cur.map((x) => x.slug),
    ['a', 'b', 'c'],
  );
  assert.equal(cur[0]!.qty, 2);
});
