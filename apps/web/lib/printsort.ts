/**
 * Display-only sorting for the print list. Pure and framework-free (operates on
 * any { name, lang, qty } row, not the React CartItem type) so it can be
 * unit-tested and reused. Returns a new array; the stored cart order is never
 * mutated, and setQty/remove key off slug+lang so display order is cosmetic.
 */

export type PrintSort = 'added' | 'name' | 'qty';

export const PRINT_SORTS: { value: PrintSort; label: string }[] = [
  { value: 'added', label: 'Added order' },
  { value: 'name', label: 'Name (A-Z)' },
  { value: 'qty', label: 'Quantity (high to low)' },
];

export function isPrintSort(v: unknown): v is PrintSort {
  return v === 'added' || v === 'name' || v === 'qty';
}

interface SortableRow {
  name: string;
  lang: string;
  qty: number;
}

/** Return a new array sorted per mode. 'added' preserves the input order. */
export function sortPrintList<T extends SortableRow>(items: T[], mode: PrintSort): T[] {
  const copy = items.slice();
  const byName = (a: T, b: T) => a.name.localeCompare(b.name) || a.lang.localeCompare(b.lang);
  if (mode === 'name') copy.sort(byName);
  else if (mode === 'qty') copy.sort((a, b) => b.qty - a.qty || byName(a, b));
  return copy; // 'added' -> untouched copy
}
