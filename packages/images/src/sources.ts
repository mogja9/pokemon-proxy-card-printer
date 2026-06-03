/**
 * Per-language image source resolver. Returns an ordered candidate list (best
 * quality first); the pipeline fetches the first that succeeds and records its
 * REAL measured dimensions, so the DPI label is always honest.
 *
 * EN: pokemontcg.io image CDN (~296 DPI, byte-identical to malie.io) then TCGdex.
 * Other langs: TCGdex high.png (~242 DPI).
 * JA native ~350 (pokemon-card.com) requires per-card detail-page scraping with
 * no id mapping yet - structured here as a TODO origin, not enabled.
 */
import type { Lang } from '@proxyforge/config';

export type ImageOrigin = 'pokemontcg_io' | 'tcgdex_assets' | 'pokemon_card_jp';

export interface ImageCandidate {
  origin: ImageOrigin;
  lang: Lang;
  url: string;
  qualityRank: number; // 350->100, 296->80, 242->60
  format: 'png' | 'jpg';
}

/** canonical (TCGdex padded) set id -> pokemontcg.io's unpadded id (best-effort). */
export function canonicalToPtcgSetId(setId: string): string {
  // 'sv03' -> 'sv3', 'me04' -> 'me4'; leaves 'swsh1', 'base1', 'sv10' unchanged.
  return setId.replace(/([a-z])0(\d)/i, '$1$2');
}

/** printed number -> pokemontcg.io number (strip leading zeros for pure numerics). */
export function localIdToPtcgNum(localId: string): string {
  return /^\d+$/.test(localId) ? String(Number.parseInt(localId, 10)) : localId;
}

export interface ResolveInput {
  setId: string;
  localId: string;
  lang: Lang;
  /** the TCGdex image base recorded in Phase 1 (image_variant.source_url). */
  tcgdexImageBase?: string | null;
  /** allow the pokemontcg.io EN hi-res CDN (default true). */
  enHires?: boolean;
}

export function resolveSources(input: ResolveInput): ImageCandidate[] {
  const out: ImageCandidate[] = [];

  if (input.lang === 'en' && input.enHires !== false) {
    const ps = canonicalToPtcgSetId(input.setId);
    const num = localIdToPtcgNum(input.localId);
    out.push({
      origin: 'pokemontcg_io',
      lang: 'en',
      url: `https://images.pokemontcg.io/${ps}/${num}_hires.png`,
      qualityRank: 80,
      format: 'png',
    });
  }

  if (input.tcgdexImageBase) {
    out.push({
      origin: 'tcgdex_assets',
      lang: input.lang,
      url: `${input.tcgdexImageBase}/high.png`,
      qualityRank: 60,
      format: 'png',
    });
  }

  return out;
}
