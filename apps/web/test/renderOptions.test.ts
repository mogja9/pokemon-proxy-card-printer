import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RENDER_OPTIONS,
  parseRenderOptions,
  loadRenderOptions,
  serializeRenderOptions,
} from '../lib/renderOptions';

test('parseRenderOptions returns defaults for non-object input', () => {
  assert.deepEqual(parseRenderOptions(null), DEFAULT_RENDER_OPTIONS);
  assert.deepEqual(parseRenderOptions('nope'), DEFAULT_RENDER_OPTIONS);
  assert.deepEqual(parseRenderOptions(42), DEFAULT_RENDER_OPTIONS);
});

test('parseRenderOptions keeps valid fields and falls back per-field', () => {
  assert.deepEqual(
    parseRenderOptions({ target: 'mpc', paper: 'letter', dpi: '600', bleed: true, gutter: '8', deckName: 'My Deck' }),
    { target: 'mpc', paper: 'letter', dpi: '600', bleed: true, gutter: '8', deckName: 'My Deck' },
  );
  // invalid enum values fall back, valid ones survive
  const r = parseRenderOptions({ target: 'xyz', paper: 'A4', dpi: 999, bleed: 'yes' });
  assert.equal(r.target, 'pdf');
  assert.equal(r.paper, 'A4');
  assert.equal(r.dpi, '300');
  assert.equal(r.bleed, false);
});

test('clamps gutter to 0..20 integer millimetres', () => {
  assert.equal(parseRenderOptions({ gutter: '100' }).gutter, '20');
  assert.equal(parseRenderOptions({ gutter: -5 }).gutter, '0');
  assert.equal(parseRenderOptions({ gutter: '3.7' }).gutter, '4');
  assert.equal(parseRenderOptions({ gutter: 'abc' }).gutter, DEFAULT_RENDER_OPTIONS.gutter);
});

test('caps deckName length to 80', () => {
  assert.equal(parseRenderOptions({ deckName: 'a'.repeat(120) }).deckName.length, 80);
});

test('loadRenderOptions tolerates null and malformed JSON', () => {
  assert.deepEqual(loadRenderOptions(null), DEFAULT_RENDER_OPTIONS);
  assert.deepEqual(loadRenderOptions('{not json'), DEFAULT_RENDER_OPTIONS);
  assert.deepEqual(loadRenderOptions('{"dpi":"600"}').dpi, '600');
});

test('serialize then load round-trips a valid options object', () => {
  const o = { target: 'mpc', paper: 'letter', dpi: '600', bleed: true, gutter: '12', deckName: 'Lugia' } as const;
  assert.deepEqual(loadRenderOptions(serializeRenderOptions(o)), o);
});
