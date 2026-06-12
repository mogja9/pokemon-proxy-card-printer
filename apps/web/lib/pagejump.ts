/**
 * Clamp a user-entered page number to a valid 1..totalPages integer. Pure +
 * unit-tested so the browse pager's jump box can rely on it; tolerant of blank,
 * non-numeric, fractional, and out-of-range input (which all snap to a valid
 * page rather than producing an empty result set).
 */
export function clampPage(raw: string | number, totalPages: number): number {
  const max = Number.isFinite(totalPages) ? Math.max(1, Math.floor(totalPages)) : 1;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return 1; // blank / NaN / Infinity -> first page
  return Math.min(max, Math.max(1, n));
}
