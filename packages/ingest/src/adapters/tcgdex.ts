import type { Lang } from '@proxyforge/config';
import { LAUNCH_LANGS } from '@proxyforge/config';
import { fetchJson, RateLimiter } from '../http.js';
import type {
  CardBrief,
  NormalizedCard,
  SetBrief,
  SetDetail,
  SourceAdapter,
} from '../types.js';

// ---- raw TCGdex response shapes (only the fields we use) ----
interface RawSetBrief {
  id: string;
  name: string;
  logo?: string;
  symbol?: string;
  cardCount?: { total?: number; official?: number };
}
interface RawCardBrief {
  id: string;
  localId: string;
  name: string;
  image?: string;
}
interface RawSetDetail extends RawSetBrief {
  serie?: { id: string; name: string };
  releaseDate?: string;
  legal?: { standard?: boolean; expanded?: boolean };
  abbreviation?: { official?: string };
  cards?: RawCardBrief[];
}
interface RawCardFull {
  id: string;
  localId: string;
  name: string;
  image?: string;
  category?: string; // Pokemon | Trainer | Energy
  rarity?: string;
  illustrator?: string;
  hp?: number | string;
  types?: string[];
  stage?: string;
  suffix?: string;
  regulationMark?: string;
  retreat?: number;
  dexId?: number[];
  variants?: unknown;
  attacks?: unknown;
  abilities?: unknown;
  effect?: string;
  description?: string;
  serie?: { id: string };
}

function toInt(v: unknown): number | undefined {
  if (v === undefined || v === null) return undefined;
  const n = typeof v === 'number' ? v : Number.parseInt(String(v), 10);
  return Number.isFinite(n) ? n : undefined;
}

function detectPromoSet(id: string, name: string, serieId?: string): boolean {
  if (/promo/i.test(name)) return true;
  if (serieId && /^(tcgp)$/i.test(serieId)) return false;
  // common promo set-id suffix 'p' (basep, svp, swshp, mep, xyp, ...) - short ids only
  return /^[a-z]{2,6}p$/i.test(id);
}

function detectDigitalOnly(name: string, serieId?: string): boolean {
  if (serieId && /^tcgp$/i.test(serieId)) return true;
  return /pocket/i.test(name);
}

export class TcgdexAdapter implements SourceAdapter {
  readonly name = 'tcgdex' as const;
  readonly isSpine = true;
  private readonly base: string;
  private readonly limiter: RateLimiter;

  constructor(baseUrl: string, rps = 4) {
    this.base = baseUrl.replace(/\/$/, '');
    this.limiter = new RateLimiter(rps);
  }

  languages(): readonly Lang[] {
    return LAUNCH_LANGS;
  }

  private url(lang: Lang, path: string): string {
    return `${this.base}/${lang}${path}`;
  }

  async listSets(lang: Lang): Promise<SetBrief[]> {
    const raw = await fetchJson<RawSetBrief[]>(this.url(lang, '/sets'), { limiter: this.limiter });
    if (!raw) return [];
    return raw.map((s) => ({
      id: s.id,
      name: s.name,
      cardCountTotal: s.cardCount?.total,
      cardCountOfficial: s.cardCount?.official,
      logoUrl: s.logo,
      symbolUrl: s.symbol,
    }));
  }

  async getSet(lang: Lang, setId: string): Promise<SetDetail | null> {
    const raw = await fetchJson<RawSetDetail>(
      this.url(lang, `/sets/${encodeURIComponent(setId)}`),
      { limiter: this.limiter },
    );
    if (!raw) return null;
    const cards: CardBrief[] = (raw.cards ?? []).map((c) => ({
      id: c.id,
      localId: c.localId,
      name: c.name,
      imageBase: c.image,
    }));
    return {
      id: raw.id,
      name: raw.name,
      cardCountTotal: raw.cardCount?.total,
      cardCountOfficial: raw.cardCount?.official,
      logoUrl: raw.logo,
      symbolUrl: raw.symbol,
      seriesId: raw.serie?.id,
      seriesName: raw.serie?.name,
      ptcgCode: raw.abbreviation?.official,
      releaseDate: raw.releaseDate,
      legalStandard: raw.legal?.standard,
      legalExpanded: raw.legal?.expanded,
      isPromoSet: detectPromoSet(raw.id, raw.name, raw.serie?.id),
      isDigitalOnly: detectDigitalOnly(raw.name, raw.serie?.id),
      cards,
      raw,
    };
  }

  /** Cheap card from the set's brief list (no extra request). */
  briefToCard(brief: CardBrief, set: SetDetail): NormalizedCard {
    return {
      sourceId: brief.id,
      localId: brief.localId,
      name: brief.name,
      ...(brief.imageBase !== undefined ? { imageBase: brief.imageBase } : {}),
      isPromo: set.isPromoSet,
      isDigitalOnly: set.isDigitalOnly,
      raw: brief,
    };
  }

  /** Rich per-card fetch (used with --full). */
  async getCard(lang: Lang, cardId: string): Promise<NormalizedCard | null> {
    const c = await fetchJson<RawCardFull>(this.url(lang, `/cards/${encodeURIComponent(cardId)}`), {
      limiter: this.limiter,
    });
    if (!c) return null;
    const subtypes: string[] = [];
    if (c.stage) subtypes.push(c.stage);
    if (c.suffix) subtypes.push(c.suffix);
    return {
      sourceId: c.id,
      localId: c.localId,
      name: c.name,
      ...(c.image !== undefined ? { imageBase: c.image } : {}),
      ...(c.category !== undefined ? { supertype: c.category } : {}),
      subtypes,
      ...(c.types !== undefined ? { types: c.types } : {}),
      ...(toInt(c.hp) !== undefined ? { hp: toInt(c.hp) } : {}),
      ...(c.rarity !== undefined ? { rarity: c.rarity } : {}),
      ...(c.regulationMark !== undefined ? { regulationMark: c.regulationMark } : {}),
      ...(c.dexId !== undefined ? { nationalPokedex: c.dexId } : {}),
      ...(toInt(c.retreat) !== undefined ? { retreatCost: toInt(c.retreat) } : {}),
      ...(c.variants !== undefined ? { variants: c.variants } : {}),
      ...(c.attacks !== undefined ? { attacks: c.attacks } : {}),
      ...(c.abilities !== undefined ? { abilities: c.abilities } : {}),
      ...(c.illustrator !== undefined ? { illustrator: c.illustrator } : {}),
      ...(c.description !== undefined ? { flavorText: c.description } : {}),
      ...(c.attacks !== undefined ? { attacksText: c.attacks } : {}),
      ...(c.abilities !== undefined ? { abilitiesText: c.abilities } : {}),
      isPromo: detectPromoSet(c.serie?.id ?? '', '', c.serie?.id),
      isDigitalOnly: detectDigitalOnly('', c.serie?.id),
      raw: c,
    };
  }

  setFingerprint(set: SetBrief): string {
    return `${set.cardCountTotal ?? '?'}:${set.cardCountOfficial ?? '?'}:${set.name}`;
  }
}
