/**
 * Backfill + incremental ingestion over a SourceAdapter (the TCGdex spine).
 *
 * Ordering: English first so it seeds shared (Western) card_print rows and the
 * English language-independent fields; fr/de/it/es/pt then attach localizations
 * to the SAME rows (shared set IDs); ja/ko/zh-* create their own rows.
 */
import type { Lang } from '@proxyforge/config';
import { withTransaction, getPool } from '@proxyforge/db';
import type { SetBrief, SourceAdapter, NormalizedCard, SetDetail } from './types.js';
import {
  upsertSeries,
  upsertCardSet,
  upsertCardPrint,
  upsertLocalization,
  upsertTcgdexImage,
  recordSetState,
  getSetState,
} from './repo.js';

export interface IngestOptions {
  langs: Lang[];
  /** fetch full per-card detail (richer but many more requests). */
  full?: boolean;
  /** dev: cap sets per language. */
  limitSets?: number;
  /** refresh the card_display materialized view at the end. */
  refreshMv?: boolean;
}

export interface IngestStats {
  setsProcessed: number;
  setsNew: number;
  setsChanged: number;
  setsSkipped: number;
  cardsUpserted: number;
  errors: { lang: Lang; setId: string; error: string }[];
}

function emptyStats(): IngestStats {
  return {
    setsProcessed: 0,
    setsNew: 0,
    setsChanged: 0,
    setsSkipped: 0,
    cardsUpserted: 0,
    errors: [],
  };
}

/**
 * A card inherits its set's promo/digital nature. briefToCard derives these
 * from the set, but getCard (the --full path) re-derives them from the card's
 * SERIES id, which misses promo sets (e.g. set 'svp' has series 'sv'), marking
 * promo cards is_promo=false. Apply the authoritative set flags so both paths
 * agree. Monotonic: only ever adds promo/digital-ness, which is always correct
 * for a card that belongs to a promo/digital set.
 */
export function applySetFlags(
  card: NormalizedCard,
  set: Pick<SetDetail, 'isPromoSet' | 'isDigitalOnly'>,
): NormalizedCard {
  return {
    ...card,
    isPromo: card.isPromo || set.isPromoSet,
    isDigitalOnly: card.isDigitalOnly || set.isDigitalOnly,
  };
}

/** Ingest ONE (lang, set). Returns number of cards upserted. */
async function ingestSet(
  adapter: SourceAdapter,
  lang: Lang,
  brief: SetBrief,
  opts: IngestOptions,
): Promise<number> {
  const detail = await adapter.getSet(lang, brief.id);
  if (!detail) return 0;

  return withTransaction(async (client) => {
    const seriesId = await upsertSeries(client, {
      tcgdexId: detail.seriesId ?? 'misc',
      nameEn: detail.seriesName ?? detail.seriesId ?? 'Miscellaneous',
    });
    const cardSetId = await upsertCardSet(client, detail, seriesId);

    let count = 0;
    for (const cb of detail.cards) {
      const raw = opts.full
        ? ((await adapter.getCard(lang, cb.id)) ?? adapter.briefToCard(cb, detail))
        : adapter.briefToCard(cb, detail);
      const card = applySetFlags(raw, detail);

      const printId = await upsertCardPrint(client, cardSetId, card);
      await upsertLocalization(client, printId, lang, card);
      const imageBase = card.imageBase ?? cb.imageBase;
      if (imageBase) await upsertTcgdexImage(client, printId, lang, imageBase);
      count += 1;
    }
    return count;
  });
}

/** Full backfill across all requested languages. */
export async function backfill(adapter: SourceAdapter, opts: IngestOptions): Promise<IngestStats> {
  const stats = emptyStats();
  const langs = orderLangs(opts.langs);

  for (const lang of langs) {
    let sets = await adapter.listSets(lang);
    if (opts.limitSets && opts.limitSets > 0) sets = sets.slice(0, opts.limitSets);
    console.log(`[backfill] ${lang}: ${sets.length} sets`);

    for (const set of sets) {
      try {
        const n = await ingestSet(adapter, lang, set, opts);
        stats.cardsUpserted += n;
        stats.setsProcessed += 1;
        await withTransaction((c) =>
          recordSetState(c, adapter.name, `${lang}:${set.id}`, adapter.setFingerprint(set), n),
        );
        console.log(`[backfill]   ${lang}/${set.id} (${set.name}) -> ${n} cards`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        stats.errors.push({ lang, setId: set.id, error: msg });
        console.error(`[backfill]   ${lang}/${set.id} FAILED: ${msg}`);
      }
    }
  }

  if (opts.refreshMv) await refreshMv();
  return stats;
}

/** Incremental: only re-ingest sets whose fingerprint changed (or are new). */
export async function incremental(
  adapter: SourceAdapter,
  opts: IngestOptions,
): Promise<IngestStats> {
  const stats = emptyStats();
  const langs = orderLangs(opts.langs);

  for (const lang of langs) {
    let sets = await adapter.listSets(lang);
    if (opts.limitSets && opts.limitSets > 0) sets = sets.slice(0, opts.limitSets);

    for (const set of sets) {
      const key = `${lang}:${set.id}`;
      const fp = adapter.setFingerprint(set);
      const prev = await withTransaction((c) => getSetState(c, adapter.name, key));
      if (prev === fp) {
        stats.setsSkipped += 1;
        continue;
      }
      const isNew = prev === null;
      try {
        const n = await ingestSet(adapter, lang, set, opts);
        stats.cardsUpserted += n;
        stats.setsProcessed += 1;
        if (isNew) stats.setsNew += 1;
        else stats.setsChanged += 1;
        await withTransaction((c) => recordSetState(c, adapter.name, key, fp, n));
        console.log(`[incremental] ${isNew ? 'NEW' : 'CHG'} ${lang}/${set.id} -> ${n} cards`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        stats.errors.push({ lang, setId: set.id, error: msg });
        console.error(`[incremental] ${lang}/${set.id} FAILED: ${msg}`);
      }
    }
  }

  if (opts.refreshMv) await refreshMv();
  return stats;
}

/** Put English first (seeds shared Western rows + language-independent fields). */
function orderLangs(langs: Lang[]): Lang[] {
  return [...langs].sort((a, b) => (a === 'en' ? -1 : b === 'en' ? 1 : 0));
}

async function refreshMv(): Promise<void> {
  console.log('[ingest] refreshing card_display materialized view...');
  await getPool().query('REFRESH MATERIALIZED VIEW card_display');
}
