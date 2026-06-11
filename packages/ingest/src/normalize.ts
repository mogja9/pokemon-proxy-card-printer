/**
 * Collector-number + set-id normalization. `normalizeCollectorNumber` MUST stay
 * byte-for-byte equivalent to the SQL `normalize_collector_number` trigger in
 * db/schema.sql (the natural key depends on both agreeing). See test/normalize.test.ts.
 */

/**
 * Normalize a printed collector number to the language-agnostic natural key.
 * lowercase -> remove spaces -> strip ONLY leading / after-separator zero-runs
 * before a digit. Interior zeros are kept ('100' stays '100').
 *
 *   '001' -> '1'   'TG 12' -> 'tg12'   'GG01' -> 'gg1'
 *   'SV-P-001' -> 'sv-p-1'   '100' -> '100'   '010' -> '10'
 *
 * NOTE: this does NOT JS-.trim() the input. The SQL trigger uses btrim (ASCII
 * space only) + replace(' ',''), so it removes spaces but KEEPS edge tabs/
 * newlines/NBSP. `.trim()` would strip those, diverging from the stored key on
 * such inputs. Removing spaces here matches SQL exactly (byte-for-byte).
 */
export function normalizeCollectorNumber(raw: string): string {
  let s = raw.toLowerCase();
  s = s.replace(/ /g, '');
  s = s.replace(/(^|[^0-9])0+([0-9])/g, '$1$2');
  return s;
}

/** Split a printed number into (prefix, numeric) for natural sort. */
export function parseCollector(raw: string): { prefix: string; num: number | null } {
  const m = raw.trim().match(/^([^\d]*)(\d+)/);
  if (!m) return { prefix: raw.trim().toUpperCase(), num: null };
  const prefix = (m[1] ?? '').replace(/[-\s]+$/, '').toUpperCase();
  const num = Number.parseInt(m[2] ?? '', 10);
  return { prefix, num: Number.isFinite(num) ? num : null };
}

/**
 * Explicit pokemontcg.io -> canonical (TCGdex padded) set-id aliases for the
 * Mega-evolution era, where ptcgio is unpadded. NOT a blind zero-pad: 'sv3'->'sv03'
 * but 'swsh1' stays 'swsh1'. The set-matcher learns/persists additional aliases.
 */
const PTCG_SET_ALIASES: Record<string, string> = {
  me1: 'me01',
  me2: 'me02',
  me2pt5: 'me02.5',
  'me2.5': 'me02.5',
  me3: 'me03',
  me4: 'me04',
  me5: 'me05',
};

/** Normalize a foreign (pokemontcg.io) set id toward the canonical TCGdex form. */
export function normalizeForeignSetId(source: 'pokemontcg_io', foreignId: string): string {
  const key = foreignId.trim().toLowerCase();
  if (source === 'pokemontcg_io') {
    if (PTCG_SET_ALIASES[key]) return PTCG_SET_ALIASES[key]!;
    // sv<single-digit> -> sv0<digit>; svN.5 -> sv0N.5 (Mega/SV padding only)
    const m = key.match(/^sv(\d)(\.5)?$/);
    if (m) return `sv0${m[1]}${m[2] ?? ''}`;
  }
  return key;
}
