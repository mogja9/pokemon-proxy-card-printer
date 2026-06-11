/**
 * Resolve a print_list (DB) into renderable PrintItems. Best image per
 * (card_print, requested lang) with English-image fallback, mirroring the
 * card_display read-model pick. Phase 1 images are hotlinks (remote_url); Phase 2
 * adds storage_key (SeaweedFS) fetch.
 */
import { query } from '@proxyforge/db';
import type { Lang } from '@proxyforge/config';
import type { PrintItem } from './homepdf.js';

export async function fetchImageBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { 'user-agent': 'ProxyForge/0.1 (+print)' } });
  if (!res.ok) throw new Error(`image fetch ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

interface ResolvedRow {
  slug: string;
  lang: Lang;
  quantity: number;
  url: string | null;
  storage_key: string | null;
}

export interface ResolveResult {
  items: PrintItem[];
  missing: { slug: string; lang: Lang }[];
}

/** Resolve every item of a print_list into PrintItems (with image bytes). */
export async function resolvePrintList(printListId: string): Promise<ResolveResult> {
  const { rows } = await query<ResolvedRow>(
    `SELECT cp.slug,
            pli.lang,
            pli.quantity,
            best.remote_url AS url,
            best.storage_key
     FROM print_list_item pli
     JOIN card_print cp ON cp.id = pli.card_print_id
     LEFT JOIN LATERAL (
       SELECT iv.remote_url, iv.storage_key
       FROM image_variant iv
       WHERE iv.card_print_id = pli.card_print_id
         AND iv.lang IN (pli.lang, 'en')
         AND (iv.storage_key IS NOT NULL OR iv.remote_url IS NOT NULL)
       ORDER BY CASE WHEN iv.lang = pli.lang THEN 0 ELSE 1 END, iv.quality_rank DESC
       LIMIT 1
     ) best ON TRUE
     WHERE pli.print_list_id = $1
     ORDER BY pli.position`,
    [printListId],
  );

  const items: PrintItem[] = [];
  const missing: { slug: string; lang: Lang }[] = [];
  for (const r of rows) {
    if (!r.url) {
      // storage_key (S3) fetch is Phase 2; for now we need a hotlink URL.
      missing.push({ slug: r.slug, lang: r.lang });
      continue;
    }
    try {
      const image = await fetchImageBuffer(r.url);
      items.push({ image, quantity: r.quantity, label: `${r.slug}_${r.lang}` });
    } catch {
      // one unreachable image must not abort the whole print job - report it as
      // missing and keep resolving the rest.
      missing.push({ slug: r.slug, lang: r.lang });
    }
  }
  return { items, missing };
}
