/**
 * Lightweight, parser-free lint for a pasted decklist: find lines that name the
 * same card more than once (PTCGL exports occasionally split a playset across
 * two lines). Import merges them by card anyway, so this is purely informational
 * feedback. Kept framework-free and independent of @proxyforge/print (which the
 * client cannot import) so it can run in the browser and be unit-tested.
 */

// Mirror of the qty prefix accepted by parseDeckList: `<qty> [x] <rest>`.
const QTY_RE = /^(\d+)\s*x?\s+(.+)$/i;

/** Card identity for dedupe: the portion after the quantity, case/space-folded. */
function lineKey(rest: string): string {
  return rest.trim().toLowerCase().replace(/\s+/g, ' ');
}

export interface DuplicateLine {
  name: string; // first-seen spelling of the card portion
  occurrences: number; // how many lines named it
  totalQty: number; // summed quantity across those lines
}

/** Return cards named on more than one line, in first-seen order. */
export function findDuplicateLines(text: string): DuplicateLine[] {
  const seen = new Map<string, DuplicateLine>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = QTY_RE.exec(line);
    if (!m) continue; // header / title / "Total Cards: 60"
    const qty = Number.parseInt(m[1]!, 10);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const rest = m[2]!.trim();
    const key = lineKey(rest);
    const cur = seen.get(key);
    if (cur) {
      cur.occurrences += 1;
      cur.totalQty += qty;
    } else {
      seen.set(key, { name: rest, occurrences: 1, totalQty: qty });
    }
  }
  return [...seen.values()].filter((v) => v.occurrences > 1);
}

/** Human summary, e.g. "Combined 2 duplicate lines: Pikachu SVI 94 (x6), Iono (x3)." */
export function summarizeDuplicates(dups: DuplicateLine[]): string {
  if (!dups.length) return '';
  const list = dups.map((d) => `${d.name} (x${d.totalQty})`).join(', ');
  return `Combined ${dups.length} duplicate line${dups.length === 1 ? '' : 's'}: ${list}.`;
}
