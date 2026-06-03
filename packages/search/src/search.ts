/** Query-time: build a Meili /search request and run it. */
import { INDEX_NAME, type CardDoc } from './document.js';
import type { MeiliClient } from './client.js';

export interface SearchQuery {
  lang: string;
  q?: string;
  set?: string;
  supertype?: string;
  promoOnly?: boolean;
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

/** Pure: turn a SearchQuery into a Meili /search request body. */
export function buildSearchRequest(p: SearchQuery): MeiliRequest {
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, p.pageSize ?? DEFAULT_PAGE_SIZE));
  const page = Math.max(1, p.page ?? 1);
  const q = (p.q ?? '').trim();

  const filter = [`lang = ${filterValue(p.lang)}`];
  if (p.set) filter.push(`setId = ${filterValue(p.set)}`);
  if (p.supertype) filter.push(`supertype = ${filterValue(p.supertype)}`);
  if (p.promoOnly) filter.push('isPromo = true');

  const req: MeiliRequest = { q, filter, page, hitsPerPage: pageSize };
  // No text query -> deterministic catalog order (newest set first), mirroring the
  // Postgres browse ordering. With a query, Meili's relevance ranking wins.
  if (!q) req.sort = ['releaseTs:desc', 'setId:asc', 'collectorNumberNum:asc'];
  return req;
}

export async function searchDocs(client: MeiliClient, p: SearchQuery): Promise<SearchHits> {
  const req = buildSearchRequest(p);
  const res = await client.search<CardDoc>(INDEX_NAME, req as unknown as Record<string, unknown>);
  return {
    docs: res.hits,
    total: res.totalHits,
    page: res.page,
    pageSize: res.hitsPerPage,
    totalPages: res.totalPages,
  };
}
