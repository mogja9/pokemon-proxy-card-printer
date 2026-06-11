/**
 * Per-language image source resolver. Returns an ordered candidate list (best
 * quality first); the pipeline fetches the first that succeeds and records its
 * REAL measured dimensions, so the DPI label is always honest.
 *
 * EN + fr/de/it/es: malie.io TCGL extract (~296 DPI, verified 733x1024) first,
 *   then pokemontcg.io (EN only, deprecated/Scrydex), then TCGdex high.png (~242).
 * pt + ja/ko/zh: TCGdex high.png (~242) - malie has no native art for them.
 * JA native ~350 (pokemon-card.com) requires per-card detail-page scraping with
 *   no id mapping yet - structured as a TODO origin, not enabled here.
 *
 * malie.io verified live 2026-06-11 (see docs/OPEN_ITEMS.md): deterministic
 * manifest -> image URLs, no per-card scraping, $0. It replaces the now-paywalled
 * pokemontcg.io EN route and upgrades fr/de/it/es above TCGdex's ~242.
 */
import type { Lang } from '@proxyforge/config';

export type ImageOrigin =
  | 'pokemontcg_io'
  | 'malie_io'
  | 'tcgdex_assets'
  | 'pokemon_card_jp';

export interface ImageCandidate {
  origin: ImageOrigin;
  lang: Lang;
  url: string;
  qualityRank: number; // 350->100, 296->80, 242->60
  format: 'png' | 'jpg';
}

/**
 * Langs malie.io serves natively (the TCGL game-client locales). `pt` is
 * EXCLUDED on purpose: malie's Portuguese is Brazilian (pt-BR) but this
 * project's `pt` is Portugal Portuguese (config: "NEVER pt-br"), so serving
 * pt-BR art under a `pt` row would violate the data model. en/fr/de/it/es
 * align 1:1 with our codes.
 */
const MALIE_LANGS: ReadonlySet<Lang> = new Set<Lang>(['en', 'fr', 'de', 'it', 'es']);

/** canonical (TCGdex padded) set id -> pokemontcg.io's unpadded id (best-effort). */
export function canonicalToPtcgSetId(setId: string): string {
  // 'sv03' -> 'sv3', 'me04' -> 'me4'; leaves 'swsh1', 'base1', 'sv10' unchanged.
  return setId.replace(/([a-z])0(\d)/i, '$1$2');
}

/** printed number -> pokemontcg.io number (strip leading zeros for pure numerics). */
export function localIdToPtcgNum(localId: string): string {
  return /^\d+$/.test(localId) ? String(Number.parseInt(localId, 10)) : localId;
}

/**
 * Explicit canonical (TCGdex) -> malie/TCGL set-id overrides where no rule
 * derives the mapping. Verified 2026-06-11 against the live TCGdex /sets and the
 * malie manifest. (svalt/mealt/sve/mee/rsv10-5/zsv10-5 are malie-specific
 * groupings still pending a live cross-check - see docs/OPEN_ITEMS.md.)
 */
const MALIE_SET_OVERRIDES: Record<string, string> = {
  svp: 'svbsp', // SV Black Star Promos
  mep: 'mebsp', // ME Black Star Promos
};

/**
 * canonical (TCGdex padded) set id -> malie/TCGL set id. TCGL unpads SV/Mega-era
 * ids ('sv03' -> 'sv3') and writes half-sets with a hyphen ('sv03.5' -> 'sv3-5');
 * a few promo sets need an explicit override. An unmapped id resolves 'absent'
 * in the manifest and the pipeline falls through to TCGdex.
 */
export function canonicalToMalieSetId(setId: string): string {
  const override = MALIE_SET_OVERRIDES[setId.toLowerCase()];
  if (override) return override;
  // 'sv03.5' -> unpad 'sv3.5' -> malie hyphen form 'sv3-5'
  return canonicalToPtcgSetId(setId).replace(/\.5$/, '-5');
}

/** printed number -> malie's 3-digit zero-padded form (pure numerics only). */
export function localIdToMalieNum(localId: string): string {
  return /^\d+$/.test(localId) ? localId.padStart(3, '0') : localId;
}

/**
 * Deterministic malie.io standard-finish PNG URL. Verified pattern (2026-06-11):
 * cdn.malie.io/file/malie-io/tcgl/cards/png/{lang}/{set}/{set}_{lang}_{num}_std.png
 */
export function malieImageUrl(lang: Lang, setId: string, localId: string): string {
  const set = canonicalToMalieSetId(setId);
  const num = localIdToMalieNum(localId);
  return `https://cdn.malie.io/file/malie-io/tcgl/cards/png/${lang}/${set}/${set}_${lang}_${num}_std.png`;
}

export interface ResolveInput {
  setId: string;
  localId: string;
  lang: Lang;
  /** the TCGdex image base recorded in Phase 1 (image_variant.source_url). */
  tcgdexImageBase?: string | null;
  /**
   * allow third-party hi-res sources (malie.io for all Western langs, plus the
   * deprecated pokemontcg.io for EN). Default true; `--no-en-hires` sets false
   * to force TCGdex-only.
   */
  enHires?: boolean;
}

export function resolveSources(input: ResolveInput): ImageCandidate[] {
  const out: ImageCandidate[] = [];
  const hires = input.enHires !== false;

  // malie.io (~296 DPI) - primary hi-res for the Western game-client langs.
  // Replaces paywalled pokemontcg.io for EN; upgrades fr/de/it/es above TCGdex.
  if (hires && MALIE_LANGS.has(input.lang)) {
    out.push({
      origin: 'malie_io',
      lang: input.lang,
      url: malieImageUrl(input.lang, input.setId, input.localId),
      qualityRank: 80,
      format: 'png',
    });
  }

  // pokemontcg.io EN hi-res - DEPRECATED (merged into paid Scrydex), kept as a
  // secondary EN fallback behind malie since the free CDN may still resolve.
  if (hires && input.lang === 'en') {
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
