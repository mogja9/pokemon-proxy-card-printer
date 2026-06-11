import { loadConfig, type Lang } from '@proxyforge/config';
import { meiliFromConfig, searchDocs, type CardDoc } from '@proxyforge/search';
import {
  searchCards as pgSearchCards,
  servedUrl,
  type CardRow,
  type SearchParams,
  type SearchResult,
} from './db';

function docToRow(d: CardDoc, lang: Lang): CardRow {
  const imageLang = (d.imageLang as Lang | null) ?? null;
  return {
    id: d.cardPrintId,
    slug: d.slug,
    setId: d.setId,
    setCode: null, // browse rows do not need the PTCGL set code; the detail page (Postgres) fills it
    collector: d.collectorNumberRaw,
    supertype: d.supertype,
    rarity: d.rarity,
    isPromo: d.isPromo,
    name: d.name,
    lang,
    imageUrl: servedUrl(d.imageKey, d.imageRemoteUrl),
    imageLang,
    dpi: d.dpiAtTrim,
    isEnFallback: imageLang !== null && imageLang !== lang,
  };
}

/**
 * Unified search entrypoint for the web app. Uses Meilisearch when
 * SEARCH_BACKEND=meili (the default); falls back to the Postgres FTS query if
 * Meili is unreachable or the index has not been built yet, so the site still
 * works without a warm index.
 */
export async function searchCards(p: SearchParams): Promise<SearchResult> {
  const cfg = loadConfig();
  if (cfg.search.backend === 'meili') {
    try {
      const client = meiliFromConfig();
      const hits = await searchDocs(client, {
        lang: p.lang,
        ...(p.q ? { q: p.q } : {}),
        ...(p.set ? { set: p.set } : {}),
        ...(p.supertype ? { supertype: p.supertype } : {}),
        promoOnly: p.promoOnly ?? false,
        ...(p.sort ? { sort: p.sort } : {}),
        ...(p.page ? { page: p.page } : {}),
        ...(p.pageSize ? { pageSize: p.pageSize } : {}),
      });
      return {
        cards: hits.docs.map((d) => docToRow(d, p.lang)),
        total: hits.total,
        page: hits.page,
        pageSize: hits.pageSize,
      };
    } catch (err) {
      console.warn(
        '[search] Meili backend failed, falling back to Postgres:',
        err instanceof Error ? err.message : err,
      );
    }
  }
  return pgSearchCards(p);
}
