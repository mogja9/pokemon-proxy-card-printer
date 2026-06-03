/**
 * Set matcher: map a foreign (pokemontcg.io) set onto a canonical TCGdex set.
 * Pure function, no I/O - unit-tested. Cascade, highest-confidence first:
 *   1. ptcgoCode exact            -> 1.00
 *   2. releaseDate + printedTotal -> 0.95
 *   3. releaseDate + total +-3 + name similarity > 0.85 -> 0.85
 *   4. name + same series         -> 0.70
 * Anything below 0.85 should be written to set_mapping with confidence < 1.0 and
 * surfaced for manual review rather than trusted blindly.
 */
import { normalizeForeignSetId } from './normalize.js';

export interface CanonicalSet {
  setId: string; // canonical TCGdex id
  name: string;
  ptcgCode?: string;
  releaseDate?: string; // ISO date
  printedTotal?: number;
  total?: number;
  seriesId?: string;
}

export interface ForeignSet {
  id: string;
  name: string;
  ptcgoCode?: string;
  releaseDate?: string;
  printedTotal?: number;
  total?: number;
  seriesId?: string;
}

export interface SetMatch {
  canonicalSetId: string;
  rule: 'ptcgoCode' | 'date+printedTotal' | 'date+total+name' | 'name+series' | 'alias';
  confidence: number;
}

/** Dice coefficient over character bigrams (0..1). Cheap name similarity. */
export function nameSimilarity(a: string, b: string): number {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '');
  const x = norm(a);
  const y = norm(b);
  if (!x.length && !y.length) return 1;
  if (x.length < 2 || y.length < 2) return x === y ? 1 : 0;
  const bigrams = (s: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const bx = bigrams(x);
  const by = bigrams(y);
  let inter = 0;
  for (const [g, cx] of bx) {
    const cy = by.get(g);
    if (cy) inter += Math.min(cx, cy);
  }
  return (2 * inter) / (x.length - 1 + (y.length - 1));
}

function sameDate(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const d = (s: string) => s.replace(/[/.]/g, '-').slice(0, 10);
  return d(a) === d(b);
}

export function matchSet(foreign: ForeignSet, candidates: readonly CanonicalSet[]): SetMatch | null {
  // 1. ptcgoCode exact - the strongest signal, checked first.
  if (foreign.ptcgoCode) {
    const hit = candidates.find(
      (c) => c.ptcgCode && c.ptcgCode.toLowerCase() === foreign.ptcgoCode!.toLowerCase(),
    );
    if (hit) return { canonicalSetId: hit.setId, rule: 'ptcgoCode', confidence: 1.0 };
  }

  // 2. explicit alias (Mega-era padding etc.) when no ptcgoCode resolved it.
  const aliasId = normalizeForeignSetId('pokemontcg_io', foreign.id);
  const aliasHit = candidates.find((c) => c.setId === aliasId);
  if (aliasHit) return { canonicalSetId: aliasHit.setId, rule: 'alias', confidence: 0.99 };

  // 2. releaseDate + printedTotal
  if (foreign.releaseDate && foreign.printedTotal != null) {
    const hit = candidates.find(
      (c) => sameDate(c.releaseDate, foreign.releaseDate) && c.printedTotal === foreign.printedTotal,
    );
    if (hit) return { canonicalSetId: hit.setId, rule: 'date+printedTotal', confidence: 0.95 };
  }

  // 3. releaseDate + total +-3 + name similarity > 0.85
  if (foreign.releaseDate && foreign.total != null) {
    let best: { c: CanonicalSet; sim: number } | null = null;
    for (const c of candidates) {
      if (!sameDate(c.releaseDate, foreign.releaseDate)) continue;
      if (c.total == null || Math.abs(c.total - foreign.total) > 3) continue;
      const sim = nameSimilarity(c.name, foreign.name);
      if (sim > 0.85 && (!best || sim > best.sim)) best = { c, sim };
    }
    if (best) return { canonicalSetId: best.c.setId, rule: 'date+total+name', confidence: 0.85 };
  }

  // 4. name + same series (low confidence -> review)
  {
    let best: { c: CanonicalSet; sim: number } | null = null;
    for (const c of candidates) {
      if (foreign.seriesId && c.seriesId && foreign.seriesId !== c.seriesId) continue;
      const sim = nameSimilarity(c.name, foreign.name);
      if (sim > 0.9 && (!best || sim > best.sim)) best = { c, sim };
    }
    if (best) return { canonicalSetId: best.c.setId, rule: 'name+series', confidence: 0.7 };
  }

  return null;
}
