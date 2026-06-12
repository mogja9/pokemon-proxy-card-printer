/**
 * Pure summary strings for the decklist import preview/confirm flow. Kept
 * framework-free and unit-tested so the pluralization stays correct as the
 * wording evolves.
 */

const cards = (n: number) => `${n} card${n === 1 ? '' : 's'}`;
const lines = (n: number) => `${n} line${n === 1 ? '' : 's'}`;

/** Banner shown before committing: what WILL be added, and what will not match. */
export function importPreviewSummary(
  addedCopies: number,
  resolvedLines: number,
  unresolvedLines: number,
): string {
  let s = `Ready to add ${cards(addedCopies)} from ${lines(resolvedLines)}.`;
  if (unresolvedLines > 0) s += ` ${lines(unresolvedLines)} will not match.`;
  return s;
}

/** Confirmation shown after the cards are added to the print list. */
export function importAddedSummary(addedCopies: number, resolvedLines: number): string {
  return `Added ${cards(addedCopies)} from ${lines(resolvedLines)}.`;
}
