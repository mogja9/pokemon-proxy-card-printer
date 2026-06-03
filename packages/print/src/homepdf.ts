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
  DEFAULT_GUTTER_MM,
  PRINTER_MARGIN_MM,
  cellTopLeftMm,
  contentFitsPaper,
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
  /** white space between cards on the sheet, mm (default 4). */
  gutterMm?: number;
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

  const gutter = opts.gutterMm ?? DEFAULT_GUTTER_MM;
  if (!contentFitsPaper(paper, gutter)) {
    warnings.push(
      `A ${gutter}mm gutter pushes the outer cards within the printer's ${PRINTER_MARGIN_MM}mm unprintable margin on ${paper}; reduce the gutter or use A4 to avoid clipping the cards.`,
    );
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
      const cell = cellTopLeftMm(paper, row, col, gutter); // top-origin trim corner
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
    if (opts.cropMarks !== false) drawCornerCropMarks(pg, paper, gutter, slots.length, p);
  }

  return { pdf: await doc.save(), warnings, pages: pageCount, cards: slots.length };
}

/**
 * Per-card corner crop marks. With a gutter between cards, marks live in the gap
 * around each card's trim box (L-shaped ticks pointing outward from each corner),
 * so you can cut each card with the surrounding white margin.
 */
function drawCornerCropMarks(
  pg: PDFPage,
  paper: Paper,
  gutter: number,
  totalSlots: number,
  pageIndex: number,
): void {
  const pageH = PAGE_MM[paper].h;
  const w = CARD_SIZE_MM.width;
  const h = CARD_SIZE_MM.height;
  const tick = Math.min(CROP_TICK_MM, gutter > 0 ? gutter : CROP_TICK_MM);
  const ink = rgb(0, 0, 0);
  const thickness = 0.3;
  const top = (mm: number) => pageH - mm; // top-origin mm -> pdf y (mm)
  const line = (x1: number, y1: number, x2: number, y2: number) =>
    pg.drawLine({
      start: { x: mmToPt(x1), y: mmToPt(top(y1)) },
      end: { x: mmToPt(x2), y: mmToPt(top(y2)) },
      thickness,
      color: ink,
    });

  for (let i = 0; i < PER_PAGE; i++) {
    if (pageIndex * PER_PAGE + i >= totalSlots) break;
    const row = Math.floor(i / GRID.cols);
    const col = i % GRID.cols;
    const { x, y } = cellTopLeftMm(paper, row, col, gutter); // trim top-left
    const x2 = x + w;
    const y2 = y + h;
    // each corner: one horizontal + one vertical tick pointing OUTWARD
    // top-left
    line(x - tick, y, x, y);
    line(x, y - tick, x, y);
    // top-right
    line(x2, y, x2 + tick, y);
    line(x2, y - tick, x2, y);
    // bottom-left
    line(x - tick, y2, x, y2);
    line(x, y2, x, y2 + tick);
    // bottom-right
    line(x2, y2, x2 + tick, y2);
    line(x2, y2, x2, y2 + tick);
  }
}
