/**
 * The Meili document shape and the card_display -> document mapping.
 *
 * The `card_display` materialized view is purpose-built as the search read-model
 * (one row per card_print x requested language). We index it straight, so adding
 * a language or facet is a schema concern, not a code concern here.
 */
import type { IndexSettings } from './client.js';

export const INDEX_NAME = 'cards';
export const PRIMARY_KEY = 'id';

/** Meili doc id: card_print uuid + requested language. Both are id-safe (a-z0-9-_). */
export function cardDocId(cardPrintId: string, lang: string): string {
  return `${cardPrintId}__${lang}`;
}

export interface CardDoc {
  id: string;
  cardPrintId: string;
  lang: string;
  setId: string;
  slug: string;
  collectorNumberRaw: string;
  collectorPrefix: string;
  collectorNumberNum: number | null;
  name: string;
  nameEn: string | null;
  nameIsFallback: boolean;
  nameLang: string | null;
  illustrator: string | null;
  imageKey: string | null;
  imageRemoteUrl: string | null;
  imageServedMode: string | null;
  imageLang: string | null;
  imageIsEnglishFallback: boolean;
  dpiAtTrim: number | null;
  isWatermarked: boolean;
  isUpscaled: boolean;
  hasLocalizedImage: boolean;
  supertype: string | null;
  subtypes: string[];
  types: string[];
  hp: number | null;
  rarity: string | null;
  rarityDisplay: string | null;
  regulationMark: string | null;
  nationalPokedex: number[];
  isPromo: boolean;
  isJumbo: boolean;
  isError: boolean;
  isRegionalExcl: boolean;
  isSealedOnly: boolean;
  releaseDate: string | null;
  releaseTs: number;
}

/** Index settings - searchableAttributes order drives the attribute ranking rule. */
export const INDEX_SETTINGS: IndexSettings = {
  searchableAttributes: ['name', 'nameEn', 'setId', 'collectorNumberRaw', 'illustrator'],
  filterableAttributes: [
    'lang',
    'setId',
    'supertype',
    'rarity',
    'types',
    'isPromo',
    'hasLocalizedImage',
    'regulationMark',
  ],
  sortableAttributes: ['releaseTs', 'setId', 'collectorNumberNum'],
};

function asStr(v: unknown): string | null {
  return v == null ? null : String(v);
}
function asNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function asBool(v: unknown): boolean {
  return v === true || v === 1 || v === 't' || v === 'true';
}
function asStrArr(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)) : [];
}
function asNumArr(v: unknown): number[] {
  return Array.isArray(v) ? v.map((x) => Number(x)).filter((n) => Number.isFinite(n)) : [];
}

/** Map a card_display(+card_set.release_date) row to a Meili document. */
export function rowToDoc(r: Record<string, unknown>): CardDoc {
  const cardPrintId = String(r.card_print_id);
  const lang = String(r.requested_lang);
  const imageLang = asStr(r.image_lang);
  return {
    id: cardDocId(cardPrintId, lang),
    cardPrintId,
    lang,
    setId: String(r.set_id),
    slug: String(r.slug),
    collectorNumberRaw: String(r.collector_number_raw),
    collectorPrefix: asStr(r.collector_prefix) ?? '',
    collectorNumberNum: asNum(r.collector_number_num),
    name: asStr(r.display_name) ?? '',
    nameEn: asStr(r.name_en),
    nameIsFallback: asBool(r.name_is_fallback),
    nameLang: asStr(r.name_lang),
    illustrator: asStr(r.illustrator),
    imageKey: asStr(r.image_key),
    imageRemoteUrl: asStr(r.image_remote_url),
    imageServedMode: asStr(r.image_served_mode),
    imageLang,
    // recompute from served lang vs requested lang (matches the web's badge logic)
    imageIsEnglishFallback: imageLang != null && imageLang !== lang,
    dpiAtTrim: asNum(r.dpi_at_trim),
    isWatermarked: asBool(r.is_watermarked),
    isUpscaled: asBool(r.is_upscaled),
    hasLocalizedImage: asBool(r.has_localized_image),
    supertype: asStr(r.supertype),
    subtypes: asStrArr(r.subtypes),
    types: asStrArr(r.types),
    hp: asNum(r.hp),
    rarity: asStr(r.rarity),
    rarityDisplay: asStr(r.rarity_display),
    regulationMark: asStr(r.regulation_mark),
    nationalPokedex: asNumArr(r.national_pokedex),
    isPromo: asBool(r.is_promo),
    isJumbo: asBool(r.is_jumbo),
    isError: asBool(r.is_error),
    isRegionalExcl: asBool(r.is_regional_excl),
    isSealedOnly: asBool(r.is_sealed_only),
    releaseDate: asStr(r.release_date),
    // epoch seconds; null releases collapse to 0 so they sort LAST under releaseTs:desc
    releaseTs: asNum(r.release_ts) ?? 0,
  };
}
