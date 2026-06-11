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
  supertype: string | null; // Pokemon | Trainer | Energy (for grouped export)
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
 * Batched resolution: ONE query for the whole deck instead of one per line
 * (a 60-card list was up to 120 round-trips). unnest(...) WITH ORDINALITY zips
 * the input arrays and a LEFT JOIN LATERAL yields the slug (or NULL) per row,
 * keyed by the 1-based ordinality so results map back to the input order.
 *
 * DECK_BY_SETCODE_BATCH_SQL: $1 = set codes[], $2 = numbers[] (parallel arrays).
 */
export const DECK_BY_SETCODE_BATCH_SQL = `
  SELECT v.idx, best.slug, best.supertype
  FROM unnest($1::text[], $2::text[]) WITH ORDINALITY AS v(set_code, num, idx)
  LEFT JOIN LATERAL (
    SELECT cp.slug, cp.supertype
    FROM card_print cp
    JOIN card_set cs ON cs.id = cp.card_set_id
    WHERE lower(cs.ptcg_code) = lower(v.set_code)
      AND cp.collector_number_norm = normalize_collector_number(v.num)
      AND NOT cp.is_suppressed
    ORDER BY cp.id
    LIMIT 1
  ) best ON TRUE
  ORDER BY v.idx`;

/** DECK_BY_NAME_BATCH_SQL: $1 = names[], $2 = requested lang (matched there or EN). */
export const DECK_BY_NAME_BATCH_SQL = `
  SELECT v.idx, best.slug, best.supertype
  FROM unnest($1::text[]) WITH ORDINALITY AS v(name, idx)
  LEFT JOIN LATERAL (
    SELECT cp.slug, cp.supertype
    FROM card_print cp
    JOIN card_localization cl ON cl.card_print_id = cp.id AND cl.lang IN ($2, 'en')
    JOIN card_set cs ON cs.id = cp.card_set_id
    WHERE lower(cl.name) = lower(v.name) AND NOT cp.is_suppressed
    ORDER BY (cl.lang = $2) DESC, cs.release_date DESC NULLS LAST, cs.set_id
    LIMIT 1
  ) best ON TRUE
  ORDER BY v.idx`;

/**
 * Resolve a decklist to card_print slugs. (setCode, number) is tried first via
 * card_set.ptcg_code + normalize_collector_number; otherwise a name match in the
 * requested lang (falling back to EN) - covers Trainer/Energy lines and the
 * PTCGL promo-numbering cases where the set code does not map cleanly.
 */
export async function resolveDeckList(text: string, lang: Lang): Promise<DeckResolution> {
  const entries = parseDeckList(text).slice(0, MAX_DECK_ENTRIES);
  const slugFor = new Array<string | null>(entries.length).fill(null);
  const superFor = new Array<string | null>(entries.length).fill(null);

  // Pass 1 (one query): entries that carry a (setCode, number).
  const codeIdx: number[] = [];
  const codes: string[] = [];
  const nums: string[] = [];
  entries.forEach((e, i) => {
    if (e.setCode && e.number) {
      codeIdx.push(i);
      codes.push(e.setCode);
      nums.push(e.number);
    }
  });
  if (codeIdx.length) {
    const r = await query<{ idx: number; slug: string | null; supertype: string | null }>(
      DECK_BY_SETCODE_BATCH_SQL,
      [codes, nums],
    );
    for (const row of r.rows) {
      const i = codeIdx[Number(row.idx) - 1]!;
      slugFor[i] = row.slug ?? null;
      superFor[i] = row.supertype ?? null;
    }
  }

  // Pass 2 (one query): everything still unresolved, by name (Trainer/Energy,
  // or a set code that did not map).
  const nameIdx: number[] = [];
  const names: string[] = [];
  entries.forEach((e, i) => {
    if (slugFor[i] == null) {
      nameIdx.push(i);
      names.push(e.name);
    }
  });
  if (nameIdx.length) {
    const r = await query<{ idx: number; slug: string | null; supertype: string | null }>(
      DECK_BY_NAME_BATCH_SQL,
      [names, lang],
    );
    for (const row of r.rows) {
      const i = nameIdx[Number(row.idx) - 1]!;
      slugFor[i] = row.slug ?? null;
      superFor[i] = row.supertype ?? null;
    }
  }

  const resolved: ResolvedDeckItem[] = [];
  const unresolved: UnresolvedDeckItem[] = [];
  entries.forEach((e, i) => {
    const slug = slugFor[i];
    if (slug) {
      resolved.push({ qty: e.qty, name: e.name, slug, lang, supertype: superFor[i] ?? null });
    } else {
      unresolved.push({
        qty: e.qty,
        name: e.name,
        reason: e.setCode ? `not found (${e.setCode} ${e.number})` : 'not found by name',
      });
    }
  });
  return { resolved, unresolved };
}
