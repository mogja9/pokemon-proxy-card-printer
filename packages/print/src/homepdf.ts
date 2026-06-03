/**
 * Mode A - home-print PDF: 3x3 N-up at fixed 63x88mm, optional synthesized bleed,
 * vector crop marks (crisp at any printer DPI), A4/Letter, ink-saver, 300/600.
 * Bleed requires A4 (sec.8.3); Letter+bleed auto-switches to A4 with a warning.
 */
import { PDFDocument, rgb, type PDFPage } from 'pdf-lib';
import { CARD_SIZE_MM } from '@proxyforge/config';
import {
  PAGE_MM,
  GRID,
  PER_PAGE,
  HOME_BLEED_MM,
  CROP_TICK_MM,
  cellTopLeftMm,
  pageLayoutMm,
  mmToPt,
  type Paper,
  type Dpi,
} from './geometry.js';
import { prepareCardImage, type BleedStyle } from './prepare.js';

export interface PrintItem {
  image: Buffer;
  quantity: number;
  label?: string;
}

export interface HomePdfOptions {
  paper: Paper;
  dpi: Dpi;
  withBleed?: boolean;
  inkSaver?: boolean;
  cropMarks?: boolean;
  bleedStyle?: BleedStyle;
}

export interface HomePdfResult {
  pdf: Uint8Array;
  warnings: string[];
  pages: number;
  cards: number;
}

export async function renderHomePdf(
  items: PrintItem[],
  opts: HomePdfOptions,
): Promise<HomePdfResult> {
  const warnings: string[] = [];
  let paper = opts.paper;
  if (opts.withBleed && paper === 'letter') {
    warnings.push(
      'Bleed requires A4 (nine full-bleed 63x88mm cards exceed US Letter height); switched to A4.',
    );
    paper = 'A4';
  }

  // prepare each unique image once, then expand by quantity into slots
  const slots: Buffer[] = [];
  for (const it of items) {
    const prepared = await prepareCardImage(it.image, {
      dpi: opts.dpi,
      mode: opts.withBleed ? 'home-bleed' : 'home-trim',
      ...(opts.inkSaver !== undefined ? { inkSaver: opts.inkSaver } : {}),
      ...(opts.bleedStyle !== undefined ? { bleedStyle: opts.bleedStyle } : {}),
    });
    for (let i = 0; i < it.quantity; i++) slots.push(prepared.png);
  }

  const doc = await PDFDocument.create();
  const page = PAGE_MM[paper];
  const bleedMm = opts.withBleed ? HOME_BLEED_MM : 0;
  const drawWmm = CARD_SIZE_MM.width + 2 * bleedMm;
  const drawHmm = CARD_SIZE_MM.height + 2 * bleedMm;

  const pageCount = Math.max(1, Math.ceil(slots.length / PER_PAGE));
  for (let p = 0; p < pageCount; p++) {
    const pg = doc.addPage([mmToPt(page.w), mmToPt(page.h)]);
    for (let i = 0; i < PER_PAGE; i++) {
      const idx = p * PER_PAGE + i;
      if (idx >= slots.length) break;
      const row = Math.floor(i / GRID.cols);
      const col = i % GRID.cols;
      const cell = cellTopLeftMm(paper, row, col); // top-origin
      const xMm = cell.x - bleedMm;
      const yTopMm = cell.y - bleedMm;
      const yMm = page.h - (yTopMm + drawHmm); // flip to bottom-origin
      const png = await doc.embedPng(slots[idx]!);
      pg.drawImage(png, {
        x: mmToPt(xMm),
        y: mmToPt(yMm),
        width: mmToPt(drawWmm),
        height: mmToPt(drawHmm),
      });
    }
    if (opts.cropMarks !== false) drawCropMarks(pg, paper);
  }

  return { pdf: await doc.save(), warnings, pages: pageCount, cards: slots.length };
}

/** Vector crop ticks where every trim line meets the page margin. */
function drawCropMarks(pg: PDFPage, paper: Paper): void {
  const { x0, y0, blockW, blockH, page } = pageLayoutMm(paper);
  const tick = CROP_TICK_MM;
  const ink = rgb(0, 0, 0);
  const thickness = 0.3;
  const top = (mm: number) => page.h - mm; // top-origin mm -> pdf y (mm)

  const line = (x1: number, y1: number, x2: number, y2: number) =>
    pg.drawLine({
      start: { x: mmToPt(x1), y: mmToPt(y1) },
      end: { x: mmToPt(x2), y: mmToPt(y2) },
      thickness,
      color: ink,
    });

  // vertical trim lines (4) -> ticks above and below the block
  for (let c = 0; c <= GRID.cols; c++) {
    const x = x0 + c * CARD_SIZE_MM.width;
    line(x, top(y0 - tick), x, top(y0)); // top margin
    line(x, top(y0 + blockH), x, top(y0 + blockH + tick)); // bottom margin
  }
  // horizontal trim lines (4) -> ticks in left and right margins
  for (let r = 0; r <= GRID.rows; r++) {
    const y = y0 + r * CARD_SIZE_MM.height;
    line(x0 - tick, top(y), x0, top(y)); // left margin
    line(x0 + blockW, top(y), x0 + blockW + tick, top(y)); // right margin
  }
}
