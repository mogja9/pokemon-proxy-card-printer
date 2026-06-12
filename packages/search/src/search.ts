/** Query-time: build a Meili /search request and run it. */
import { indexNameForLang, type CardDoc } from './document.js';
import type { MeiliClient } from './client.js';

/** Browse sort orders (all use existing Meili sortable attributes - no reindex). */
export type BrowseSort = 'newest' | 'oldest' | 'set';

const BROWSE_SORTS: Record<BrowseSort, string[]> = {
  newest: ['releaseTs:desc', 'setId:asc', 'collectorNumberNum:asc'],
  oldest: ['releaseTs:asc', 'setId:asc', 'collectorNumberNum:asc'],
  set: ['setId:asc', 'collectorNumberNum:asc'],
};

export interface SearchQuery {
  lang: string;
  q?: string;
  set?: string;
  supertype?: string;
  promoOnly?: boolean;
  sort?: BrowseSort;
  page?: number;
  pageSize?: number;
}

export interface SearchHits {
  docs: CardDoc[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface MeiliRequest {
  q: string;
  filter: string[];
  sort?: string[];
  page: number;
  hitsPerPage: number;
}

const DEFAULT_PAGE_SIZE = 48;
const MAX_PAGE_SIZE = 120;

/** Quote + escape a value for use inside a Meili filter expression. */
export function filterValue(v: string): string {
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Clamp to an integer in [min,max], falling back to def for any non-finite
 * input (undefined, NaN, +/-Infinity) or a fractional value. Keeps a malformed
 * page/pageSize from reaching Meili as NaN or a non-integer hitsPerPage.
 */
function clampInt(v: number | undefined, min: number, max: number, def: number): number {
  const n = Math.floor(v as number);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

/** Pure: turn a SearchQuery into a Meili /search request body. */
export function buildSearchRequest(p: SearchQuery): MeiliRequest {
  const pageSize = clampInt(p.pageSize, 1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE);
  const page = clampInt(p.page, 1, Number.MAX_SAFE_INTEGER, 1);
  const q = (p.q ?? '').trim();

  // The index IS the language now (cards_<lang>), so no lang filter is needed.
  const filter: string[] = [];
  if (p.set) filter.push(`setId = ${filterValue(p.set)}`);
  if (p.supertype) filter.push(`supertype = ${filterValue(p.supertype)}`);
  if (p.promoOnly) filter.push('isPromo = true');

  const req: MeiliRequest = { q, filter, page, hitsPerPage: pageSize };
  // No text query -> deterministic browse order chosen by the user (default
  // newest). With a query, Meili's relevance ranking wins (sort is ignored).
  if (!q) req.sort = BROWSE_SORTS[p.sort ?? 'newest'];
  return req;
}

export async function searchDocs(client: MeiliClient, p: SearchQuery): Promise<SearchHits> {
  const req = buildSearchRequest(p);
  const res = await client.search<CardDoc>(
    indexNameForLang(p.lang),
    req as unknown as Record<string, unknown>,
  );
  return {
    docs: res.hits,
    total: res.totalHits,
    page: res.page,
    pageSize: res.hitsPerPage,
    totalPages: res.totalPages,
  };
}
