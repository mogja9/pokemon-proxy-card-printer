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

test('pageLayoutMm: centered 3x3 block origins', () => {
  const a4 = pageLayoutMm('A4');
  assert.equal(a4.blockW, 189);
  assert.equal(a4.blockH, 264);
  assert.equal(a4.x0, 10.5);
  assert.equal(a4.y0, 16.5);
  const lt = pageLayoutMm('letter');
  assert.ok(Math.abs(lt.x0 - 13.45) < 1e-9);
  assert.ok(Math.abs(lt.y0 - 7.7) < 1e-9);
});

test('bleedFitsPaper: A4 yes, Letter no (sec.8.3)', () => {
  assert.equal(bleedFitsPaper('A4'), true);
  assert.equal(bleedFitsPaper('letter'), false);
});
