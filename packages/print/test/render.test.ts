import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { prepareCardImage } from '../src/prepare.js';
import { renderHomePdf } from '../src/homepdf.js';
import { renderMpcZip, mpcBracket } from '../src/mpc.js';
import { fetchImageBuffer } from '../src/resolve.js';
import { trimPx, mpcCanvasPx } from '../src/geometry.js';

const RUN = process.env.PPF_RUN_NET_TESTS === '1';

// pure (always runs)
test('mpcBracket: smallest tier >= quantity', () => {
  assert.equal(mpcBracket(1), 18);
  assert.equal(mpcBracket(18), 18);
  assert.equal(mpcBracket(19), 36);
  assert.equal(mpcBracket(240), 396); // the documented overshoot footgun
  assert.equal(mpcBracket(99999), 612);
});

// network-gated: fetch real TCGdex art and render
const IMG = 'https://assets.tcgdex.net/en/sv/sv03/004/high.png';

test('prepareCardImage: home-trim -> exact trim px', { skip: !RUN }, async () => {
  const buf = await fetchImageBuffer(IMG);
  const p = await prepareCardImage(buf, { dpi: 300, mode: 'home-trim' });
  assert.deepEqual({ w: p.widthPx, h: p.heightPx }, trimPx(300));
});

test('prepareCardImage: mpc -> 822x1122 canvas', { skip: !RUN }, async () => {
  const buf = await fetchImageBuffer(IMG);
  const p = await prepareCardImage(buf, { dpi: 300, mode: 'mpc' });
  assert.deepEqual({ w: p.widthPx, h: p.heightPx }, mpcCanvasPx(300));
});

test('renderHomePdf: valid PDF, 1 page for <=9 cards', { skip: !RUN }, async () => {
  const buf = await fetchImageBuffer(IMG);
  const res = await renderHomePdf([{ image: buf, quantity: 4, label: 'scyther' }], {
    paper: 'A4',
    dpi: 300,
    withBleed: true,
  });
  assert.equal(res.pages, 1);
  assert.equal(res.cards, 4);
  assert.equal(strFromU8(res.pdf.slice(0, 5)), '%PDF-');
  assert.ok(res.pdf.length > 5000);
});

test('renderHomePdf: Letter+bleed warns and switches to A4', { skip: !RUN }, async () => {
  const buf = await fetchImageBuffer(IMG);
  const res = await renderHomePdf([{ image: buf, quantity: 1 }], {
    paper: 'letter',
    dpi: 300,
    withBleed: true,
  });
  assert.ok(res.warnings.some((w) => /A4/.test(w)));
});

test('renderMpcZip: valid zip with order.xml + front PNG', { skip: !RUN }, async () => {
  const buf = await fetchImageBuffer(IMG);
  const res = await renderMpcZip([{ image: buf, quantity: 2, label: 'scyther' }], { dpi: 300 });
  assert.equal(res.totalCards, 2);
  assert.equal(res.bracket, 18);
  const entries = unzipSync(res.zip);
  const names = Object.keys(entries);
  assert.ok(names.includes('order.xml'));
  assert.ok(names.some((n) => n.startsWith('fronts/') && n.endsWith('.png')));
  const xml = strFromU8(entries['order.xml']!);
  assert.ok(xml.includes('<quantity>2</quantity>'));
  assert.ok(xml.includes('<slots>0,1</slots>'));
});
