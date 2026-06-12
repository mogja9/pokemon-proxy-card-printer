/**
 * Print-list quantity helpers. Pure + unit-tested so the row controls (typed
 * input and the -/+ steppers) share one clamp: floor to an integer in
 * [0,999], with 0 meaning "remove" (the cart drops rows at qty 0). Non-finite
 * input collapses to 0 rather than propagating NaN into the stored cart.
 */

export const QTY_MIN = 0;
export const QTY_MAX = 999;

/** Coerce to an integer in [QTY_MIN, QTY_MAX]; non-finite -> QTY_MIN. */
export function clampQty(n: number): number {
  const f = Math.floor(n);
  if (!Number.isFinite(f)) return QTY_MIN;
  return Math.min(QTY_MAX, Math.max(QTY_MIN, f));
}

/** Step a (possibly unclamped) quantity by delta, staying within bounds. */
export function stepQty(current: number, delta: number): number {
  return clampQty(clampQty(current) + delta);
}
