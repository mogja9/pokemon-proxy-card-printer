/**
 * Compute and format the "showing X-Y of N" range for a paged result. Pure +
 * unit-tested. Clamps a past-the-end page to a sane in-range slice so the label
 * never reads backwards (from > to), even though the pager normally prevents it.
 */

export interface PageRange {
  from: number;
  to: number;
  total: number;
}

export function pageRange(page: number, pageSize: number, total: number): PageRange {
  if (total <= 0 || pageSize <= 0) return { from: 0, to: 0, total: Math.max(0, total) };
  const rawFrom = (Math.max(1, page) - 1) * pageSize + 1;
  const from = Math.max(1, Math.min(rawFrom, total));
  const to = Math.max(from, Math.min(total, Math.max(1, page) * pageSize));
  return { from, to, total };
}

export function formatPageRange(r: PageRange): string {
  if (r.total <= 0) return 'No cards';
  const n = (x: number) => x.toLocaleString();
  // a single full page (or fewer) -> just the total, no redundant 1-N range
  if (r.from === 1 && r.to === r.total) return `${n(r.total)} card${r.total === 1 ? '' : 's'}`;
  return `Showing ${n(r.from)}-${n(r.to)} of ${n(r.total)}`;
}
