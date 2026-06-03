/**
 * Print geometry. SIZE is fixed (63x88mm); DPI is the only variable axis.
 * All layout math is done in millimetres and converted to px/pt at the boundary.
 * Numbers here are pinned to architecture sec.8 (incl. the sec.8.8 worked example).
 */
import { CARD_SIZE_MM, mmToPx } from '@proxyforge/config';

export type Paper = 'A4' | 'letter';
export type Dpi = 300 | 600;

/** Home-cut uniform bleed = 1/8 in (Mode A). Distinct from the MPC canvas bleed. */
export const HOME_BLEED_MM = 3.175;
export const SAFE_ZONE_MM = 3.175;
export const CORNER_RADIUS_MM = 3;
export const CROP_TICK_MM = 3;

export const PAGE_MM: Record<Paper, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  letter: { w: 215.9, h: 279.4 },
};

export const GRID = { cols: 3, rows: 3 } as const;
export const PER_PAGE = GRID.cols * GRID.rows;

export interface Px {
  w: number;
  h: number;
}
export interface BleedPx {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Trim size in px at a DPI. 744x1039 @300, 1488x2079 @600. */
export function trimPx(dpi: number): Px {
  return { w: mmToPx(CARD_SIZE_MM.width, dpi), h: mmToPx(CARD_SIZE_MM.height, dpi) };
}

/** MakePlayingCards canvas: 822x1122 @300, scales with DPI. */
export function mpcCanvasPx(dpi: number): Px {
  const scale = dpi / 300;
  return { w: Math.round(822 * scale), h: Math.round(1122 * scale) };
}

/**
 * Per-side MPC bleed = (canvas - trim)/2, centered. Asymmetric by spec:
 * @300 -> left/right 39, top/bottom 42/41 (canvas H-trim H = 83 is odd).
 */
export function mpcBleedPx(dpi: number): BleedPx {
  const t = trimPx(dpi);
  const c = mpcCanvasPx(dpi);
  const lr = c.w - t.w;
  const tb = c.h - t.h;
  const left = Math.floor(lr / 2);
  const top = Math.ceil(tb / 2);
  return { left, right: lr - left, top, bottom: tb - top };
}

/** Home uniform bleed in px. */
export function homeBleedPx(dpi: number): BleedPx {
  const b = mmToPx(HOME_BLEED_MM, dpi);
  return { left: b, right: b, top: b, bottom: b };
}

export interface PageLayout {
  page: { w: number; h: number };
  blockW: number;
  blockH: number;
  x0: number;
  y0: number;
}

/** 3x3 trim block centered on the page (mm, top-left origin). */
export function pageLayoutMm(paper: Paper): PageLayout {
  const page = PAGE_MM[paper];
  const blockW = GRID.cols * CARD_SIZE_MM.width; // 189
  const blockH = GRID.rows * CARD_SIZE_MM.height; // 264
  return { page, blockW, blockH, x0: (page.w - blockW) / 2, y0: (page.h - blockH) / 2 };
}

/** Top-left (mm, top-origin) of a cell's TRIM box. */
export function cellTopLeftMm(paper: Paper, row: number, col: number): { x: number; y: number } {
  const { x0, y0 } = pageLayoutMm(paper);
  return { x: x0 + col * CARD_SIZE_MM.width, y: y0 + row * CARD_SIZE_MM.height };
}

export function mmToPt(mm: number): number {
  return (mm / 25.4) * 72;
}

/**
 * With home bleed, the inked footprint is blockH + 2*bleed tall. On US Letter that
 * exceeds the printer's safe area, so bleed requires A4 (see sec.8.3).
 */
export function bleedFitsPaper(paper: Paper): boolean {
  if (paper === 'A4') return true;
  const { y0 } = pageLayoutMm(paper);
  return y0 - HOME_BLEED_MM >= 6.35; // 1/4in printer unprintable margin
}
