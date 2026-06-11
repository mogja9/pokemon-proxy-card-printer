/**
 * The Meili document shape and the card_display -> document mapping.
 *
 * The `card_display` materialized view is purpose-built as the search read-model
 * (one row per card_print x requested language). We index it straight, so adding
 * a language or facet is a schema concern, not a code concern here.
 */
import type { IndexSettings } from './client.js';

/**
 * One Meili index per language (`cards_en … cards_zh-tw`), per ARCHITECTURE.md
 * sec "Search": per-index `localizedAttributes` forces the correct CJK
 * tokenizer (jpn/cmn/kor) instead of one mixed index, and `nameEn` stays
 * searchable in every index so an English query still finds the JA card.
 */
export const INDEX_PREFIX = 'cards';
export const PRIMARY_KEY = 'id';

/** Per-language index uid. lang codes are uid-safe (a-z0-9-_), incl. `zh-cn`. */
export function indexNameForLang(lang: string): string {
  return `${INDEX_PREFIX}_${lang}`;
}

/** Our lang code -> ISO-639-3 locale for Meili `localizedAttributes`. */
const LANG_LOCALE: Record<string, string> = {
  en: 'eng',
  ja: 'jpn',
  fr: 'fra',
  de: 'deu',
  it: 'ita',
  es: 'spa',
  pt: 'por',
  ko: 'kor',
  'zh-cn': 'cmn',
  'zh-tw': 'cmn',
};

/** ISO-639-3 locale for a lang (defaults to English if unknown). */
export function localeForLang(lang: string): string {
  return LANG_LOCALE[lang] ?? 'eng';
}

/**
 * Base settings + per-language `localizedAttributes`: the localized `name` is
 * tokenized in this index's language; `nameEn` is always tokenized as English
 * so cross-language English queries match.
 */
export function settingsForLang(lang: string): IndexSettings {
  return {
    ...INDEX_SETTINGS,
    localizedAttributes: [
      { attributePatterns: ['nameEn'], locales: ['eng'] },
      { attributePatterns: ['name'], locales: [localeForLang(lang)] },
    ],
  };
}

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
  // The catalog is ~34k prints x 10 langs; Meili's default maxTotalHits (1000)
  // would silently truncate the browse total and cap deep pagination. Raise it
  // so the reported count is honest and every filtered card is reachable.
  pagination: { maxTotalHits: 100000 },
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
