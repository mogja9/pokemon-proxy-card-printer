/**
 * Render-options persistence for the print page. The shape mirrors the print
 * form controls; parseRenderOptions validates/clamps an untrusted stored value
 * (per-field fallback to defaults) so a corrupt or stale localStorage entry can
 * never put the form into an invalid state. Pure + unit-tested; the window glue
 * lives in the component.
 */

import type { PrintSort } from './printsort';
import type { ExportFormat } from './printlist';

export interface RenderOptions {
  target: 'pdf' | 'mpc';
  paper: 'A4' | 'letter';
  dpi: '300' | '600';
  bleed: boolean;
  gutter: string; // millimetres, '0'..'20'
  deckName: string;
  printSort: PrintSort; // print-list display order
  exportFormat: ExportFormat; // decklist export shape
}

export const DEFAULT_RENDER_OPTIONS: RenderOptions = {
  target: 'pdf',
  paper: 'A4',
  dpi: '300',
  bleed: false,
  gutter: '4',
  deckName: '',
  printSort: 'added',
  exportFormat: 'grouped',
};

const TARGETS = ['pdf', 'mpc'] as const;
const PAPERS = ['A4', 'letter'] as const;
const DPIS = ['300', '600'] as const;
const PRINT_SORTS = ['added', 'name', 'qty'] as const;
const EXPORT_FORMATS = ['grouped', 'plain'] as const;

function pick<T extends string>(allowed: readonly T[], v: unknown, fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

function clampGutter(v: unknown): string {
  const n = typeof v === 'string' || typeof v === 'number' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return DEFAULT_RENDER_OPTIONS.gutter;
  return String(Math.max(0, Math.min(20, Math.round(n))));
}

/** Validate an untrusted (parsed) value into a complete RenderOptions. */
export function parseRenderOptions(raw: unknown): RenderOptions {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    target: pick(TARGETS, o.target, DEFAULT_RENDER_OPTIONS.target),
    paper: pick(PAPERS, o.paper, DEFAULT_RENDER_OPTIONS.paper),
    dpi: pick(DPIS, o.dpi, DEFAULT_RENDER_OPTIONS.dpi),
    bleed: typeof o.bleed === 'boolean' ? o.bleed : DEFAULT_RENDER_OPTIONS.bleed,
    gutter: clampGutter(o.gutter),
    deckName: typeof o.deckName === 'string' ? o.deckName.slice(0, 80) : DEFAULT_RENDER_OPTIONS.deckName,
    printSort: pick(PRINT_SORTS, o.printSort, DEFAULT_RENDER_OPTIONS.printSort),
    exportFormat: pick(EXPORT_FORMATS, o.exportFormat, DEFAULT_RENDER_OPTIONS.exportFormat),
  };
}

/** Parse a JSON string (or null) from storage into RenderOptions, never throwing. */
export function loadRenderOptions(json: string | null): RenderOptions {
  if (!json) return { ...DEFAULT_RENDER_OPTIONS };
  try {
    return parseRenderOptions(JSON.parse(json));
  } catch {
    return { ...DEFAULT_RENDER_OPTIONS };
  }
}

export function serializeRenderOptions(o: RenderOptions): string {
  return JSON.stringify(parseRenderOptions(o));
}
