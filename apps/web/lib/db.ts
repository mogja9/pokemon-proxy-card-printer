import { query } from '@proxyforge/db';
import type { Lang } from '@proxyforge/config';

/** storage_key -> our /img route; else the hotlink remote_url; else null. */
export function servedUrl(storageKey: string | null, remoteUrl: string | null): string | null {
  if (storageKey) return `/img/${storageKey}`;
  return remoteUrl ?? null;
}

export interface CardRow {
  id: string;
  slug: string;
  setId: string;
  collector: string;
  supertype: string | null;
  rarity: string | null;
  isPromo: boolean;
  name: string;
  lang: Lang;
  imageUrl: string | null;
  imageLang: Lang | null;
  dpi: number | null;
  isEnFallback: boolean;
}

const BEST_IMAGE = `
  LEFT JOIN LATERAL (
    SELECT iv.storage_key, iv.remote_url, iv.dpi_at_trim, iv.lang
    FROM image_variant iv
    WHERE iv.card_print_id = cp.id
      AND iv.lang IN ($LANG, 'en')
      AND (iv.storage_key IS NOT NULL OR iv.remote_url IS NOT NULL)
      AND NOT iv.has_bleed
    ORDER BY CASE WHEN iv.lang = $LANG THEN 0 ELSE 1 END, iv.quality_rank DESC,
             (iv.storage_key IS NOT NULL) DESC, iv.id
    LIMIT 1
  ) img ON TRUE`;

function mapRow(r: Record<string, unknown>, lang: Lang): CardRow {
  const imgLang = (r.img_lang as Lang | null) ?? null;
  return {
    id: r.id as string,
    slug: r.slug as string,
    setId: r.set_id as string,
    collector: r.collector_number_raw as string,
    supertype: (r.supertype as string | null) ?? null,
    rarity: (r.rarity as string | null) ?? null,
    isPromo: Boolean(r.is_promo),
    name: r.name as string,
    lang,
    imageUrl: servedUrl(r.storage_key as string | null, r.remote_url as string | null),
    imageLang: imgLang,
    dpi: r.dpi_at_trim != null ? Number(r.dpi_at_trim) : null,
    isEnFallback: imgLang !== null && imgLang !== lang,
  };
}

export interface SearchParams {
  lang: Lang;
  q?: string;
  set?: string;
  supertype?: string;
  promoOnly?: boolean;
  page?: number;
  pageSize?: number;
}

export interface SearchResult {
  cards: CardRow[];
  total: number;
  page: number;
  pageSize: number;
}

export async function searchCards(p: SearchParams): Promise<SearchResult> {
  const lang = p.lang;
  const pageSize = Math.min(120, Math.max(1, p.pageSize ?? 48));
  const page = Math.max(1, p.page ?? 1);
  const where: string[] = ['NOT cp.is_digital_only', 'NOT cp.is_suppressed'];
  const params: unknown[] = [lang];
  const add = (sql: string, val: unknown) => {
    params.push(val);
    where.push(sql.replace('$$', `$${params.length}`));
  };
  if (p.q) add('cl.name ILIKE $$', `%${p.q}%`);
  if (p.set) add('cs.set_id = $$', p.set);
  if (p.supertype) add('cp.supertype = $$', p.supertype);
  if (p.promoOnly) where.push('cp.is_promo');

  const whereSql = where.join(' AND ');
  const best = BEST_IMAGE.replaceAll('$LANG', '$1');

  const countRes = await query<{ n: string }>(
    `SELECT count(*)::int AS n
     FROM card_print cp
     JOIN card_set cs ON cs.id = cp.card_set_id
     JOIN card_localization cl ON cl.card_print_id = cp.id AND cl.lang = $1
     WHERE ${whereSql}`,
    params,
  );
  const total = Number(countRes.rows[0]?.n ?? 0);

  params.push(pageSize, (page - 1) * pageSize);
  const res = await query<Record<string, unknown>>(
    `SELECT cp.id, cp.slug, cs.set_id, cp.collector_number_raw, cp.supertype, cp.rarity,
            cp.is_promo, cl.name,
            img.storage_key, img.remote_url, img.dpi_at_trim, img.lang AS img_lang
     FROM card_print cp
     JOIN card_set cs ON cs.id = cp.card_set_id
     JOIN card_localization cl ON cl.card_print_id = cp.id AND cl.lang = $1
     ${best}
     WHERE ${whereSql}
     ORDER BY cs.release_date DESC NULLS LAST, cs.set_id,
              cp.collector_prefix, cp.collector_number_num NULLS LAST, cp.collector_number_raw
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { cards: res.rows.map((r) => mapRow(r, lang)), total, page, pageSize };
}

export interface CardDetail {
  card: CardRow;
  localizations: { lang: Lang; name: string; hasImage: boolean }[];
}

export async function getCardBySlug(slug: string, lang: Lang): Promise<CardDetail | null> {
  const best = BEST_IMAGE.replaceAll('$LANG', '$2');
  const res = await query<Record<string, unknown>>(
    `SELECT cp.id, cp.slug, cs.set_id, cp.collector_number_raw, cp.supertype, cp.rarity,
            cp.is_promo, COALESCE(cl.name, len.name) AS name,
            img.storage_key, img.remote_url, img.dpi_at_trim, img.lang AS img_lang
     FROM card_print cp
     JOIN card_set cs ON cs.id = cp.card_set_id
     LEFT JOIN card_localization cl  ON cl.card_print_id = cp.id AND cl.lang = $2
     LEFT JOIN card_localization len ON len.card_print_id = cp.id AND len.lang = 'en'
     ${best}
     WHERE cp.slug = $1 AND NOT cp.is_suppressed
     LIMIT 1`,
    [slug, lang],
  );
  if (!res.rows.length) return null;
  const card = mapRow({ ...res.rows[0] }, lang);

  const locs = await query<{ lang: Lang; name: string; has_image: boolean }>(
    `SELECT cl.lang, cl.name,
            EXISTS (SELECT 1 FROM image_variant iv
                    WHERE iv.card_print_id = cl.card_print_id AND iv.lang = cl.lang
                      AND (iv.storage_key IS NOT NULL OR iv.remote_url IS NOT NULL)) AS has_image
     FROM card_localization cl
     JOIN card_print cp ON cp.id = cl.card_print_id
     WHERE cp.slug = $1
     ORDER BY cl.lang`,
    [slug],
  );
  return {
    card,
    localizations: locs.rows.map((r) => ({ lang: r.lang, name: r.name, hasImage: r.has_image })),
  };
}

export async function listSets(): Promise<{ setId: string; name: string }[]> {
  const res = await query<{ set_id: string; name_en: string }>(
    `SELECT set_id, name_en FROM card_set ORDER BY release_date DESC NULLS LAST, set_id`,
  );
  return res.rows.map((r) => ({ setId: r.set_id, name: r.name_en }));
}

export async function listSupertypes(): Promise<string[]> {
  const res = await query<{ supertype: string }>(
    `SELECT DISTINCT supertype FROM card_print WHERE supertype IS NOT NULL ORDER BY supertype`,
  );
  return res.rows.map((r) => r.supertype);
}
