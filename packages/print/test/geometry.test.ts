import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  trimPx,
  mpcCanvasPx,
  mpcBleedPx,
  homeBleedPx,
  cellTopLeftMm,
  pageLayoutMm,
  mmToPt,
  bleedFitsPaper,
  contentFitsPaper,
  cropTickMm,
} from '../src/geometry.js';

test('trimPx: 744x1039 @300, 1488x2079 @600 (formula-consistent)', () => {
  assert.deepEqual(trimPx(300), { w: 744, h: 1039 });
  assert.deepEqual(trimPx(600), { w: 1488, h: 2079 });
});

test('mpcCanvasPx: 822x1122 @300, doubles @600', () => {
  assert.deepEqual(mpcCanvasPx(300), { w: 822, h: 1122 });
  assert.deepEqual(mpcCanvasPx(600), { w: 1644, h: 2244 });
});

test('mpcBleedPx: asymmetric, centers trim in canvas (sec.8.8)', () => {
  // L/R = (822-744)/2 = 39; T/B = (1122-1039)=83 -> 42/41
  assert.deepEqual(mpcBleedPx(300), { left: 39, right: 39, top: 42, bottom: 41 });
  const t = trimPx(300);
  const b = mpcBleedPx(300);
  assert.equal(t.w + b.left + b.right, 822);
  assert.equal(t.h + b.top + b.bottom, 1122);
});

test('homeBleedPx: 1/8in uniform', () => {
  const b = homeBleedPx(300);
  assert.equal(b.left, b.right);
  assert.equal(b.top, b.bottom);
  assert.equal(b.left, Math.round((3.175 / 25.4) * 300)); // 38
});

test('cellTopLeftMm + mmToPt: matches the sec.8.8 worked example (A4, center cell)', () => {
  const cell = cellTopLeftMm('A4', 1, 1);
  assert.equal(cell.x, 73.5);
  assert.equal(cell.y, 104.5);
  const { page } = pageLayoutMm('A4');
  const yMm = page.h - (cell.y + 88); // bottom-origin (no bleed) for r1c1 = 104.5
  assert.equal(yMm, 104.5);
  assert.ok(Math.abs(mmToPt(cell.x) - 208.35) < 0.02, `x_pt=${mmToPt(cell.x)}`);
  assert.ok(Math.abs(mmToPt(yMm) - 296.22) < 0.02, `y_pt=${mmToPt(yMm)}`);
});

test('pageLayoutMm: centered 3x3 block origins (no gutter)', () => {
  const a4 = pageLayoutMm('A4', 0);
  assert.equal(a4.blockW, 189);
  assert.equal(a4.blockH, 264);
  assert.equal(a4.x0, 10.5);
  assert.equal(a4.y0, 16.5);
  const lt = pageLayoutMm('letter', 0);
  assert.ok(Math.abs(lt.x0 - 13.45) < 1e-9);
  assert.ok(Math.abs(lt.y0 - 7.7) < 1e-9);
});

test('bleedFitsPaper: A4 yes, Letter no (sec.8.3)', () => {
  assert.equal(bleedFitsPaper('A4'), true);
  assert.equal(bleedFitsPaper('letter'), false);
});

test('gutter: block grows by (n-1)*gutter and stays centered; cells are spaced', () => {
  // no gutter -> tight 189x264 block
  assert.equal(pageLayoutMm('A4', 0).blockW, 189);
  assert.equal(pageLayoutMm('A4', 0).blockH, 264);
  // 4mm gutter -> 189+8 x 264+8, recentered
  const g = pageLayoutMm('A4', 4);
  assert.equal(g.blockW, 197);
  assert.equal(g.blockH, 272);
  assert.equal(g.x0, (210 - 197) / 2); // 6.5
  assert.equal(g.y0, (297 - 272) / 2); // 12.5
  // adjacent cells are exactly cardSize + gutter apart
  const c00 = cellTopLeftMm('A4', 0, 0, 4);
  const c01 = cellTopLeftMm('A4', 0, 1, 4);
  const c10 = cellTopLeftMm('A4', 1, 0, 4);
  assert.equal(c01.x - c00.x, 63 + 4);
  assert.equal(c10.y - c00.y, 88 + 4);
  // default gutter is 4mm
  assert.equal(cellTopLeftMm('A4', 0, 1).x - cellTopLeftMm('A4', 0, 0).x, 67);
});

test('contentFitsPaper: trim block must stay in printable area', () => {
  assert.equal(contentFitsPaper('A4', 4), true); // A4 fits even with 4mm gutter
  assert.equal(contentFitsPaper('A4', 0), true);
  assert.equal(contentFitsPaper('letter', 0), true); // tight 264 block fits Letter
  assert.equal(contentFitsPaper('letter', 4), false); // gutter pushes outer rows into the margin
});

test('cropTickMm: <= half the gutter so adjacent ticks never overlap a card', () => {
  assert.equal(cropTickMm(0), 0); // gutter 0 -> no ticks (must not draw onto neighbours)
  assert.equal(cropTickMm(4), 2); // default gutter -> ticks meet at the midline
  assert.equal(cropTickMm(6), 3); // exactly the CROP_TICK_MM cap
  assert.equal(cropTickMm(20), 3); // capped at CROP_TICK_MM
  assert.equal(cropTickMm(-5), 0); // defensive: negative -> 0
});
