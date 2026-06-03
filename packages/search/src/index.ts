/**
 * @proxyforge/search - Meilisearch read-path + indexer for the card catalog.
 *
 * Source of truth = the `card_display` materialized view; Postgres FTS (the `pg`
 * backend in the web app) is the fallback when Meili is unavailable.
 */
import { loadConfig } from '@proxyforge/config';
import { MeiliClient } from './client.js';

export * from './client.js';
export * from './document.js';
export * from './search.js';
export * from './reindex.js';

/** Build a Meili client from app config (MEILI_URL / MEILI_MASTER_KEY). */
export function meiliFromConfig(): MeiliClient {
  const { search } = loadConfig();
  return new MeiliClient({ baseUrl: search.meiliUrl, apiKey: search.meiliMasterKey });
}
