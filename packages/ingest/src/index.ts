export * from './types.js';
export * from './normalize.js';
export * from './matcher.js';
export * from './http.js';
export { TcgdexAdapter } from './adapters/tcgdex.js';
export { PokemonTcgIoAdapter } from './adapters/ptcgio.js';
export { backfill, incremental } from './backfill.js';
export type { IngestOptions, IngestStats } from './backfill.js';

import { loadConfig } from '@proxyforge/config';
import type { SourceAdapter } from './types.js';
import { TcgdexAdapter } from './adapters/tcgdex.js';
import { PokemonTcgIoAdapter } from './adapters/ptcgio.js';

/** Build the spine adapter (TCGdex) from config. */
export function createSpineAdapter(cfg = loadConfig()): SourceAdapter {
  return new TcgdexAdapter(cfg.tcgdexBaseUrl, cfg.ingest.tcgdexRps);
}

/** Build the overlay adapter, or null when OVERLAY_ADAPTER=none (the default). */
export function createOverlayAdapter(cfg = loadConfig()): SourceAdapter | null {
  switch (cfg.overlayAdapter) {
    case 'ptcgio':
      return new PokemonTcgIoAdapter(cfg.pokemontcgIoApiKey);
    case 'scrydex':
      throw new Error('ScrydexAdapter not implemented yet (paid source; see architecture sec.3)');
    case 'none':
    default:
      return null;
  }
}
