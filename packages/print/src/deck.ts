/**
 * Decklist import. Parse a Pokemon TCG Live / Limitless text decklist and
 * resolve each line to a card_print so it can be added to the print list.
 *
 * Line format: `<qty> <name> [<setCode> <number>]`, e.g.
 *   4 Pikachu SVI 94
 *   2 Boss's Orders PAL 172
 *   3 Professor's Research        (Trainer/Energy: name only is allowed)
 * Section headers ("Pokemon: 12", "Trainer: 34", "Total Cards: 60") and blank
 * lines are ignored. parseDeckList is pure + unit-tested; resolveDeckList hits
 * the DB (set code -> card_set.ptcg_code, number -> collector_number_norm; name
 * fallback for Trainer/Energy).
 */
import { query } from '@proxyforge/db';
import type { Lang } from '@proxyforge/config';

export interface DeckEntry {
  qty: number;
  name: string;
  setCode?: string;
  number?: string;
}

const QTY_RE = /^(\d+)\s*x?\s+(.+)$/i;

/** Uppercase set code, e.g. SVI, PAL, SWSHALT, P-A, PR-SV. */
function isSetCode(t: string): boolean {
  return t.length >= 2 && /^[A-Z][A-Z0-9]*(-[A-Z0-9]+)?$/.test(t);
}

/** A collector number always contains a digit (94, TG12, SV107, GG01). */
function hasDigit(t: string): boolean {
  return /\d/.test(t);
}

/** Parse a decklist into entries. Header/blank/total lines are skipped. */
export function parseDeckList(text: string): DeckEntry[] {
  const out: DeckEntry[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = QTY_RE.exec(line);
    if (!m) continue; // header / title / "Total Cards: 60"
    const qty = Number.parseInt(m[1]!, 10);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const rest = m[2]!.trim();
    const tokens = rest.split(/\s+/);
    if (tokens.length >= 3) {
      const number = tokens[tokens.length - 1]!;
      const setCode = tokens[tokens.length - 2]!;
      if (isSetCode(setCode) && hasDigit(number)) {
        out.push({ qty, name: tokens.slice(0, -2).join(' '), setCode, number });
        continue;
      }
    }
    out.push({ qty, name: rest }); // name-only (Trainer/Energy, or unrecognized tail)
  }
  return out;
}

export interface ResolvedDeckItem {
  qty: number;
  name: string;
  slug: string;
  lang: Lang;
}
export interface UnresolvedDeckItem {
  qty: number;
  name: string;
  reason: string;
}
export interface DeckResolution {
  resolved: ResolvedDeckItem[];
  unresolved: UnresolvedDeckItem[];
}

/** Cap on entries resolved per request (a deck is 60; allow slack for sideboards). */
export const MAX_DECK_ENTRIES = 200;

/**
 * Resolve a decklist to card_print slugs. (setCode, number) is tried first via
 * card_set.ptcg_code + normalize_collector_number; otherwise a name match in the
 * requested lang (falling back to EN) - covers Trainer/Energy lines and the
 * PTCGL promo-numbering cases where the set code does not map cleanly.
 */
export async function resolveDeckList(text: string, lang: Lang): Promise<DeckResolution> {
  const entries = parseDeckList(text).slice(0, MAX_DECK_ENTRIES);
  const resolved: ResolvedDeckItem[] = [];
  const unresolved: UnresolvedDeckItem[] = [];

  for (const e of entries) {
    let slug: string | null = null;

    if (e.setCode && e.number) {
      const r = await query<{ slug: string }>(
        `SELECT cp.slug
         FROM card_print cp
         JOIN card_set cs ON cs.id = cp.card_set_id
         WHERE lower(cs.ptcg_code) = lower($1)
           AND cp.collector_number_norm = normalize_collector_number($2)
           AND NOT cp.is_suppressed
         ORDER BY cp.id
         LIMIT 1`,
        [e.setCode, e.number],
      );
      slug = r.rows[0]?.slug ?? null;
    }

    if (!slug) {
      const r = await query<{ slug: string }>(
        `SELECT cp.slug
         FROM card_print cp
         JOIN card_localization cl ON cl.card_print_id = cp.id AND cl.lang IN ($2, 'en')
         JOIN card_set cs ON cs.id = cp.card_set_id
         WHERE lower(cl.name) = lower($1) AND NOT cp.is_suppressed
         ORDER BY (cl.lang = $2) DESC, cs.release_date DESC NULLS LAST, cs.set_id
         LIMIT 1`,
        [e.name, lang],
      );
      slug = r.rows[0]?.slug ?? null;
    }

    if (slug) {
      resolved.push({ qty: e.qty, name: e.name, slug, lang });
    } else {
      unresolved.push({
        qty: e.qty,
        name: e.name,
        reason: e.setCode ? `not found (${e.setCode} ${e.number})` : 'not found by name',
      });
    }
  }

  return { resolved, unresolved };
}
