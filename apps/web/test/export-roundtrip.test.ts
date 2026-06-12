/**
 * Round-trip guard for the print-list export. The UI promises the exported
 * decklist "round-trips with Import", but buildExport (apps/web/lib/printlist)
 * and parseDeckList (@proxyforge/print) are tested only in isolation. This feeds
 * one into the other so a future change to either - the section-header shape, a
 * name with a setcode-looking tail, the qty prefix grammar - that breaks
 * re-import is caught. Exports carry no set code/number (the cart has none), so
 * re-import is by name; the property is qty+name preservation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDeckList } from '@proxyforge/print';
import { buildExport, buildPlainExport, buildDeckExport } from '../lib/printlist';

const items = [
  { qty: 4, name: 'Pikachu', supertype: 'Pokemon' },
  { qty: 2, name: "Boss's Orders", supertype: 'Trainer' },
  { qty: 8, name: 'Lightning Energy', supertype: 'Energy' },
  // a name whose tail (letters + nothing-numeric) must NOT be parsed as set+num
  { qty: 1, name: 'Mewtwo & Mew GX', supertype: 'Pokemon' },
];

const bag = (xs: { qty: number; name: string }[]) =>
  xs.map((e) => `${e.qty} ${e.name}`).sort();

test('plain export re-imports to the exact same qty+name lines, in order', () => {
  const parsed = parseDeckList(buildPlainExport(items));
  assert.deepEqual(
    parsed.map((e) => [e.qty, e.name]),
    items.map((i) => [i.qty, i.name]),
  );
  // names must survive intact (no setcode/number misparse on the GX tail)
  assert.equal(parsed.every((e) => e.setCode === undefined && e.number === undefined), true);
});

test('grouped export re-imports to the same multiset of qty+name', () => {
  const parsed = parseDeckList(buildExport(items, 'grouped'));
  assert.deepEqual(bag(parsed), bag(items));
});

test('grouped section headers/counts are skipped, not parsed as cards', () => {
  const text = buildDeckExport(items);
  assert.match(text, /Pok.mon: 5/); // header is present in the text...
  const parsed = parseDeckList(text);
  // ...but it does not leak in as an entry: exactly the original card count
  assert.equal(parsed.length, items.length);
  assert.equal(
    parsed.some((e) => /:/.test(e.name)),
    false,
    'a "Header: N" line must not become a card entry',
  );
});

test('empty list round-trips to nothing', () => {
  assert.deepEqual(parseDeckList(buildPlainExport([])), []);
  assert.deepEqual(parseDeckList(buildExport([], 'grouped')), []);
});
