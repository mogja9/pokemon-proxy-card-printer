import type { Lang } from '@proxyforge/config';

/** Source systems known to the merge core (mirrors the `source_system` enum). */
export type SourceSystem = 'tcgdex' | 'pokemontcg_io' | 'bulbapedia' | 'manual';

/** Brief set entry from a source's set list. */
export interface SetBrief {
  /** source-native set id (TCGdex: 'sv03', 'me04', 'PMCG1'). */
  id: string;
  name: string;
  cardCountTotal?: number;
  cardCountOfficial?: number;
  logoUrl?: string;
  symbolUrl?: string;
}

/** Brief card entry from a set detail's card list. */
export interface CardBrief {
  /** source-native card id ('sv03-001'). */
  id: string;
  /** printed/local number ('001', 'TG12', 'SWSH001'). */
  localId: string;
  name: string;
  /** image BASE url (append /high.png etc.), or undefined if no art. */
  imageBase?: string;
}

/** Full set detail, including the brief card list. */
export interface SetDetail extends SetBrief {
  seriesId?: string;
  seriesName?: string;
  ptcgCode?: string;
  releaseDate?: string;
  legalStandard?: boolean;
  legalExpanded?: boolean;
  isPromoSet: boolean;
  isDigitalOnly: boolean;
  cards: CardBrief[];
  /** raw payload for audit / etag. */
  raw: unknown;
}

/** Language-independent + per-language card fields, normalized across sources. */
export interface NormalizedCard {
  sourceId: string; // 'sv03-001'
  localId: string; // '001'
  name: string; // localized name
  imageBase?: string;
  // language-independent (best-effort; present only with full fetch)
  supertype?: string; // category: Pokemon|Trainer|Energy
  subtypes?: string[]; // e.g. ['Basic'] from stage
  types?: string[];
  hp?: number;
  rarity?: string;
  regulationMark?: string;
  nationalPokedex?: number[];
  retreatCost?: number;
  variants?: unknown;
  attacks?: unknown;
  abilities?: unknown;
  // per-language text
  illustrator?: string;
  flavorText?: string;
  attacksText?: unknown;
  abilitiesText?: unknown;
  rulesText?: string[];
  isPromo: boolean;
  isDigitalOnly: boolean;
  /** raw payload for audit / etag. */
  raw: unknown;
}

/**
 * Swappable data-source adapter. TCGdex is the spine (isSpine=true); pokemontcg.io
 * is a deprecated, default-OFF overlay. Adding Scrydex later = a new adapter.
 */
export interface SourceAdapter {
  readonly name: SourceSystem;
  readonly isSpine: boolean;
  /** languages this adapter can serve. */
  languages(): readonly Lang[];
  listSets(lang: Lang): Promise<SetBrief[]>;
  getSet(lang: Lang, setId: string): Promise<SetDetail | null>;
  /** optional richer per-card fetch (expensive; used with --full). */
  getCard(lang: Lang, cardId: string): Promise<NormalizedCard | null>;
  /** map a set brief's card briefs into NormalizedCard (without per-card fetch). */
  briefToCard(brief: import('./types.js').CardBrief, set: SetDetail): NormalizedCard;
  /** stable fingerprint of a set for incremental change detection. */
  setFingerprint(set: SetBrief): string;
}
