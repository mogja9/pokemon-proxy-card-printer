import type { Lang } from '@proxyforge/config';
import { fetchJson, RateLimiter } from '../http.js';
import type { CardBrief, NormalizedCard, SetBrief, SetDetail, SourceAdapter } from '../types.js';

/**
 * pokemontcg.io v2 overlay adapter (English enrichment) - DEPRECATED and OFF by
 * default (OVERLAY_ADAPTER=none). pokemontcg.io merged into the paid Scrydex, so
 * this is best-effort and may vanish. Kept behind SourceAdapter so it is swappable
 * for a future ScrydexAdapter. Only English is supported here.
 *
 * This is a thin stub: it implements the contract for set listing so the
 * set-matcher (see matcher.ts) can be exercised, but full enrichment ingest is
 * intentionally not enabled in Phase 1.
 */
interface RawPtcgSet {
  id: string;
  name: string;
  ptcgoCode?: string;
  releaseDate?: string;
  printedTotal?: number;
  total?: number;
  images?: { logo?: string; symbol?: string };
}

export class PokemonTcgIoAdapter implements SourceAdapter {
  readonly name = 'pokemontcg_io' as const;
  readonly isSpine = false;
  private readonly base = 'https://api.pokemontcg.io/v2';
  private readonly limiter = new RateLimiter(2);
  private readonly headers: Record<string, string>;

  constructor(apiKey: string) {
    this.headers = apiKey ? { 'X-Api-Key': apiKey } : {};
  }

  languages(): readonly Lang[] {
    return ['en'];
  }

  async listSets(lang: Lang): Promise<SetBrief[]> {
    if (lang !== 'en') return [];
    const pageSize = 250;
    const out: SetBrief[] = [];
    // pokemontcg.io paginates; a single fixed page silently truncates once the
    // catalogue exceeds pageSize. Follow pages until the catalogue is exhausted.
    for (let page = 1; ; page++) {
      const res = await fetchJson<{ data: RawPtcgSet[]; totalCount?: number }>(
        `${this.base}/sets?page=${page}&pageSize=${pageSize}`,
        { limiter: this.limiter, headers: this.headers },
      );
      if (!res || !res.data?.length) break;
      for (const s of res.data) {
        out.push({
          id: s.id,
          name: s.name,
          cardCountOfficial: s.printedTotal,
          cardCountTotal: s.total,
          logoUrl: s.images?.logo,
          symbolUrl: s.images?.symbol,
        });
      }
      if (res.data.length < pageSize) break;
      if (res.totalCount != null && out.length >= res.totalCount) break;
    }
    return out;
  }

  async getSet(_lang: Lang, _setId: string): Promise<SetDetail | null> {
    // Phase 1: overlay enrichment ingest not enabled.
    return null;
  }

  briefToCard(brief: CardBrief, set: SetDetail): NormalizedCard {
    return {
      sourceId: brief.id,
      localId: brief.localId,
      name: brief.name,
      isPromo: set.isPromoSet,
      isDigitalOnly: false,
      raw: brief,
    };
  }

  async getCard(_lang: Lang, _cardId: string): Promise<NormalizedCard | null> {
    return null;
  }

  setFingerprint(set: SetBrief): string {
    return `${set.cardCountOfficial ?? '?'}:${set.name}`;
  }
}
