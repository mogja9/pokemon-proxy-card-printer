/**
 * Pure print-list helpers: grouping the cart by supertype and rendering the
 * name-based export text. Kept framework-free (no React, no sharp) so it is
 * safe to import from the client print page and can be unit-tested directly.
 */

export interface PrintListItem {
  qty: number;
  name: string;
  supertype?: string | null;
}

// PTCGL section order; anything else falls after these in first-seen order.
const ORDER = ['Pokémon', 'Trainer', 'Energy'];

/** Normalize a stored supertype to its display label ("Pokemon" -> "Pokémon"). */
export function normSupertype(s?: string | null): string {
  return s === 'Pokemon' ? 'Pokémon' : s || 'Other';
}

export interface SupertypeGroup<T extends PrintListItem> {
  label: string;
  items: T[];
  count: number; // sum of qty within the group
}

/**
 * Group items by normalized supertype, ordered Pokémon, Trainer, Energy, then
 * any others in first-seen order. count is the summed quantity per group.
 */
export function groupBySupertype<T extends PrintListItem>(items: T[]): SupertypeGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const i of items) {
    const k = normSupertype(i.supertype);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(i);
  }
  const keys = [
    ...ORDER.filter((k) => groups.has(k)),
    ...[...groups.keys()].filter((k) => !ORDER.includes(k)),
  ];
  return keys.map((label) => {
    const g = groups.get(label)!;
    return { label, items: g, count: g.reduce((n, x) => n + x.qty, 0) };
  });
}

/** One-line breakdown, e.g. "12 Pokémon · 34 Trainer · 14 Energy" ('' if empty). */
export function summarizeBySupertype(items: PrintListItem[]): string {
  return groupBySupertype(items)
    .map((g) => `${g.count} ${g.label}`)
    .join(' · ');
}

/**
 * Name-based decklist text that round-trips with Import. Flat (`<qty> <name>`)
 * when no item carries a supertype; otherwise grouped with PTCGL-style section
 * headers and per-section counts.
 */
export function buildDeckExport(items: PrintListItem[]): string {
  if (!items.some((i) => i.supertype)) return buildPlainExport(items);
  return groupBySupertype(items)
    .map((g) => `${g.label}: ${g.count}\n${g.items.map((i) => `${i.qty} ${i.name}`).join('\n')}`)
    .join('\n\n');
}

/**
 * Flat `<qty> <name>` list with no section headers or counts, in the current
 * order. Some import tools reject the grouped headers; this is the safe lowest
 * common denominator and still round-trips with our own Import.
 */
export function buildPlainExport(items: PrintListItem[]): string {
  return items.map((i) => `${i.qty} ${i.name}`).join('\n');
}

export interface PrintTotals {
  copies: number; // total cards printed (sum of quantities)
  unique: number; // distinct rows (each slug+lang is one row)
}

/** Total printed copies and the number of distinct entries. */
export function printListTotals(items: { qty: number }[]): PrintTotals {
  return { copies: items.reduce((n, x) => n + x.qty, 0), unique: items.length };
}

export type ExportFormat = 'grouped' | 'plain';

/** Render the export in the chosen format. */
export function buildExport(items: PrintListItem[], format: ExportFormat): string {
  return format === 'plain' ? buildPlainExport(items) : buildDeckExport(items);
}
