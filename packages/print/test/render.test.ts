import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { prepareCardImage } from '../src/prepare.js';
import { renderHomePdf } from '../src/homepdf.js';
import { renderMpcZip, mpcBracket } from '../src/mpc.js';
import { trimPx, mpcCanvasPx } from '../src/geometry.js';
import sharp from 'sharp';

/** A solid-colour PNG (~TCGdex source size) so the render tests need no network. */
function testCardImage(): Promise<Buffer> {
  return sharp({
    create: { width: 600, height: 825, channels: 4, background: { r: 40, g: 120, b: 80, alpha: 1 } },
  })
    .png()
    .toBuffer();
}

// pure (always runs)
test('mpcBracket: smallest tier >= quantity', () => {
  assert.equal(mpcBracket(1), 18);
  assert.equal(mpcBracket(18), 18);
  assert.equal(mpcBracket(19), 36);
  assert.equal(mpcBracket(240), 396); // the documented overshoot footgun
  assert.equal(mpcBracket(99999), 612);
});

test('prepareCardImage: home-trim -> exact trim px', async () => {
  const buf = await testCardImage();
  const p = await prepareCardImage(buf, { dpi: 300, mode: 'home-trim' });
  assert.deepEqual({ w: p.widthPx, h: p.heightPx }, trimPx(300));
});

test('prepareCardImage: mpc -> 822x1122 canvas', async () => {
  const buf = await testCardImage();
  const p = await prepareCardImage(buf, { dpi: 300, mode: 'mpc' });
  assert.deepEqual({ w: p.widthPx, h: p.heightPx }, mpcCanvasPx(300));
});

test('renderHomePdf: valid PDF, 1 page for <=9 cards', async () => {
  const buf = await testCardImage();
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

test('renderHomePdf: Letter+bleed warns and switches to A4', async () => {
  const buf = await testCardImage();
  const res = await renderHomePdf([{ image: buf, quantity: 1 }], {
    paper: 'letter',
    dpi: 300,
    withBleed: true,
  });
  assert.ok(res.warnings.some((w) => /A4/.test(w)));
});

test('renderMpcZip: valid zip with order.xml + front PNG', async () => {
  const buf = await testCardImage();
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

test('renderHomePdf: N-up spans multiple pages for >9 cards', async () => {
  const buf = await testCardImage();
  // a single item whose quantity exceeds one 3x3 sheet
  const r10 = await renderHomePdf([{ image: buf, quantity: 10, label: 'x' }], {
    paper: 'A4',
    dpi: 300,
  });
  assert.equal(r10.cards, 10);
  assert.equal(r10.pages, 2); // ceil(10 / 9)

  // multiple items whose quantities accumulate across the page boundary
  const r19 = await renderHomePdf(
    [
      { image: buf, quantity: 9 },
      { image: buf, quantity: 10 },
    ],
    { paper: 'A4', dpi: 300 },
  );
  assert.equal(r19.cards, 19);
  assert.equal(r19.pages, 3); // ceil(19 / 9)
  assert.equal(strFromU8(r19.pdf.slice(0, 5)), '%PDF-');
});

test('renderMpcZip: cumulative slot indices + order.xml across multiple items', async () => {
  const buf = await testCardImage();
  const r = await renderMpcZip(
    [
      { image: buf, quantity: 2, label: 'a' },
      { image: buf, quantity: 3, label: 'b' },
    ],
    { dpi: 300 },
  );
  assert.equal(r.totalCards, 5);
  assert.equal(r.bracket, 18); // mpcBracket(5)
  const entries = unzipSync(r.zip);
  const xml = strFromU8(entries['order.xml']!);
  assert.match(xml, /<quantity>5<\/quantity>/);
  assert.match(xml, /<slots>0,1<\/slots>/); // first item -> global slots 0,1
  assert.match(xml, /<slots>2,3,4<\/slots>/); // second item -> global slots 2,3,4
  const fronts = Object.keys(entries).filter((n) => n.startsWith('fronts/') && n.endsWith('.png'));
  assert.equal(fronts.length, 2); // one PNG per distinct item
});
