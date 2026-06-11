/**
 * Per-set / per-language image COVERAGE report (OPEN_ITEMS: "make 'every card +
 * tiered gap-fill' verifiable"). For each (set, lang) it counts how many cards
 * that are actually printed in that language have a servable image, split into
 * native localized scan vs EN-fallback vs missing entirely.
 *
 * Eligibility denominator = a card_localization row exists for (card_print,
 * lang), i.e. the card is genuinely printed in that language. This correctly
 * scopes Western shared prints (en/fr/de/it/es/pt) vs the distinct ja/ko/zh
 * printings, which each carry their own card_print + localization rows.
 *
 * "any image" = the (card,lang) row is present in card_display, whose image
 * lateral is hotlink-inclusive but INNER (a card with no servable native-or-EN
 * image is absent from the MV) - so absence == not browseable == missing.
 *
 * NOTE: COVERAGE_SQL is validated only at the type level here; it needs a
 * live-DB smoke test (no Postgres in CI/dev today - see OPEN_ITEMS.md). The
 * rollup + formatting below are pure and unit-tested.
 */
import { query, type QueryResult } from '@proxyforge/db';
import type { Lang } from '@proxyforge/config';

export interface CoverageRow {
  setId: string;
  lang: string;
  eligible: number; // cards printed in this lang
  anyImage: number; // have a servable image (native or EN-fallback)
  hires: number; // of anyImage, those at hi-res DPI (>=290: the 296/350 tier)
  native: number; // have a true localized scan in this lang
  enFallback: number; // servable only via EN-fallback art
  missing: number; // no servable image at all -> not browseable
}

export const COVERAGE_SQL = `
WITH elig AS (
  SELECT cp.id AS card_print_id, cs.set_id, l.lang::text AS lang
  FROM card_print cp
  JOIN card_set cs ON cs.id = cp.card_set_id
  JOIN card_localization l ON l.card_print_id = cp.id
  WHERE NOT cp.is_digital_only AND NOT cp.is_suppressed
),
img AS (
  SELECT cd.card_print_id, cd.requested_lang AS lang, cd.has_localized_image, cd.dpi_at_trim
  FROM card_display cd
)
SELECT
  e.set_id                                                          AS "setId",
  e.lang                                                            AS lang,
  COUNT(*)                                                          AS eligible,
  COUNT(i.card_print_id)                                            AS "anyImage",
  COUNT(*) FILTER (WHERE i.dpi_at_trim >= 290)                      AS hires,
  COUNT(*) FILTER (WHERE i.has_localized_image)                     AS native,
  COUNT(*) FILTER (WHERE i.card_print_id IS NOT NULL
                     AND NOT i.has_localized_image)                 AS "enFallback",
  COUNT(*) FILTER (WHERE i.card_print_id IS NULL)                   AS missing
FROM elig e
LEFT JOIN img i
  ON i.card_print_id = e.card_print_id AND i.lang = e.lang
WHERE ($1::text[] IS NULL OR e.lang = ANY($1::text[]))
GROUP BY e.set_id, e.lang
ORDER BY e.set_id, e.lang
`;

/** Run the coverage query. pg returns bigint COUNTs as strings -> coerce. */
export async function getCoverage(langs?: Lang[]): Promise<CoverageRow[]> {
  const res: QueryResult = await query(COVERAGE_SQL, [langs && langs.length ? langs : null]);
  return res.rows.map((r) => ({
    setId: String(r.setId),
    lang: String(r.lang),
    eligible: Number(r.eligible),
    anyImage: Number(r.anyImage),
    hires: Number(r.hires),
    native: Number(r.native),
    enFallback: Number(r.enFallback),
    missing: Number(r.missing),
  }));
}

/** image coverage as a percentage (any servable image / eligible). 0..100. */
export function coveragePct(row: Pick<CoverageRow, 'eligible' | 'anyImage'>): number {
  if (row.eligible === 0) return 0;
  return Math.round((row.anyImage / row.eligible) * 1000) / 10;
}

/** Sum a set of per-(set,lang) rows into one aggregate row (setId set to label). */
export function sumRows(label: string, lang: string, rows: CoverageRow[]): CoverageRow {
  return rows.reduce(
    (acc, r) => ({
      setId: label,
      lang,
      eligible: acc.eligible + r.eligible,
      anyImage: acc.anyImage + r.anyImage,
      hires: acc.hires + r.hires,
      native: acc.native + r.native,
      enFallback: acc.enFallback + r.enFallback,
      missing: acc.missing + r.missing,
    }),
    { setId: label, lang, eligible: 0, anyImage: 0, hires: 0, native: 0, enFallback: 0, missing: 0 },
  );
}

/** Roll rows up to one total per language (across all sets), lang-sorted. */
export function rollupByLang(rows: CoverageRow[]): CoverageRow[] {
  const byLang = new Map<string, CoverageRow[]>();
  for (const r of rows) {
    const list = byLang.get(r.lang) ?? [];
    list.push(r);
    byLang.set(r.lang, list);
  }
  return [...byLang.keys()]
    .sort()
    .map((lang) => sumRows('(all sets)', lang, byLang.get(lang)!));
}

/** Render rows as a fixed-width table (pure; used by the CLI). */
export function formatCoverageTable(rows: CoverageRow[]): string {
  const header = ['set', 'lang', 'eligible', 'image', 'hi-res', 'native', 'en-fb', 'missing', 'cov%'];
  const body = rows.map((r) => [
    r.setId,
    r.lang,
    String(r.eligible),
    String(r.anyImage),
    String(r.hires),
    String(r.native),
    String(r.enFallback),
    String(r.missing),
    `${coveragePct(r).toFixed(1)}%`,
  ]);
  const widths = header.map((h, c) =>
    Math.max(h.length, ...body.map((row) => row[c]!.length)),
  );
  const line = (cells: string[]): string =>
    cells.map((cell, c) => cell.padEnd(widths[c]!)).join('  ').trimEnd();
  return [line(header), line(widths.map((w) => '-'.repeat(w))), ...body.map(line)].join('\n');
}
