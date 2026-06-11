/**
 * Idempotent upserts from NormalizedCard -> schema rows. Western langs collapse
 * into one card_print via the natural key (card_set_id, collector_number_norm);
 * ja/ko/zh-* land on their own sets -> their own rows. Every write is parameterized
 * and runs inside a per-set transaction (see backfill.ts).
 */
import { createHash } from 'node:crypto';
import type { PoolClient } from '@proxyforge/db';
import type { Lang } from '@proxyforge/config';
import type { NormalizedCard, SetDetail } from './types.js';
import { parseCollector } from './normalize.js';

export function etag(obj: unknown): string {
  return createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0, 32);
}

function regMark(v: string | undefined): string | null {
  if (!v) return null;
  const c = v.trim().toUpperCase();
  return /^[A-Z]$/.test(c) ? c : null;
}

export async function upsertSeries(
  client: PoolClient,
  s: { tcgdexId: string; nameEn: string; sortOrder?: number },
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO series (tcgdex_id, name_en, sort_order)
     VALUES ($1, $2, $3)
     ON CONFLICT (tcgdex_id) DO UPDATE SET
       name_en = COALESCE(series.name_en, EXCLUDED.name_en)
     RETURNING id`,
    [s.tcgdexId, s.nameEn, s.sortOrder ?? 0],
  );
  return rows[0]!.id;
}

export async function upsertCardSet(
  client: PoolClient,
  set: SetDetail,
  seriesId: string,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO card_set
       (set_id, series_id, name_en, ptcg_code, printed_total, total, release_date,
        legal_standard, legal_expanded, logo_key, symbol_key, is_promo_set,
        source_payload, source_etag, ingest_status, last_ingest_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,'ok',now())
     ON CONFLICT (set_id) DO UPDATE SET
       name_en        = COALESCE(EXCLUDED.name_en, card_set.name_en),
       ptcg_code      = COALESCE(EXCLUDED.ptcg_code, card_set.ptcg_code),
       printed_total  = COALESCE(EXCLUDED.printed_total, card_set.printed_total),
       total          = COALESCE(EXCLUDED.total, card_set.total),
       release_date   = COALESCE(EXCLUDED.release_date, card_set.release_date),
       legal_standard = COALESCE(EXCLUDED.legal_standard, card_set.legal_standard),
       legal_expanded = COALESCE(EXCLUDED.legal_expanded, card_set.legal_expanded),
       logo_key       = COALESCE(EXCLUDED.logo_key, card_set.logo_key),
       symbol_key     = COALESCE(EXCLUDED.symbol_key, card_set.symbol_key),
       is_promo_set   = card_set.is_promo_set OR EXCLUDED.is_promo_set,
       source_etag    = EXCLUDED.source_etag,
       ingest_status  = 'ok',
       last_ingest_at = now()
     RETURNING id`,
    [
      set.id,
      seriesId,
      set.name,
      set.ptcgCode ?? null,
      set.cardCountOfficial ?? null,
      set.cardCountTotal ?? null,
      set.releaseDate ?? null,
      set.legalStandard ?? null,
      set.legalExpanded ?? null,
      set.logoUrl ?? null,
      set.symbolUrl ?? null,
      set.isPromoSet,
      JSON.stringify({ id: set.id, name: set.name }),
      etag({ id: set.id, total: set.cardCountTotal, name: set.name }),
    ],
  );
  return rows[0]!.id;
}

/** Upsert the physical card (language-independent). Returns the card_print id. */
export async function upsertCardPrint(
  client: PoolClient,
  cardSetId: string,
  card: NormalizedCard,
): Promise<string> {
  const { prefix, num } = parseCollector(card.localId);
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO card_print
       (card_set_id, collector_number_raw, collector_prefix, collector_number_num,
        tcgdex_id, supertype, subtypes, types, hp, rarity, regulation_mark,
        national_pokedex, variants, attacks, abilities, retreat_cost,
        is_promo, is_digital_only, primary_source, source_etag, ingest_status, last_ingest_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15::jsonb,$16,
             $17,$18,'tcgdex',$19,'ok',now())
     ON CONFLICT (card_set_id, collector_number_norm) DO UPDATE SET
       tcgdex_id        = COALESCE(card_print.tcgdex_id, EXCLUDED.tcgdex_id),
       supertype        = COALESCE(EXCLUDED.supertype, card_print.supertype),
       subtypes         = CASE WHEN cardinality(EXCLUDED.subtypes) > 0 THEN EXCLUDED.subtypes ELSE card_print.subtypes END,
       types            = CASE WHEN cardinality(EXCLUDED.types) > 0 THEN EXCLUDED.types ELSE card_print.types END,
       hp               = COALESCE(EXCLUDED.hp, card_print.hp),
       rarity           = COALESCE(EXCLUDED.rarity, card_print.rarity),
       regulation_mark  = COALESCE(EXCLUDED.regulation_mark, card_print.regulation_mark),
       national_pokedex = CASE WHEN cardinality(EXCLUDED.national_pokedex) > 0 THEN EXCLUDED.national_pokedex ELSE card_print.national_pokedex END,
       variants         = CASE WHEN EXCLUDED.variants <> '{}'::jsonb THEN EXCLUDED.variants ELSE card_print.variants END,
       attacks          = CASE WHEN EXCLUDED.attacks  <> '[]'::jsonb THEN EXCLUDED.attacks  ELSE card_print.attacks  END,
       abilities        = CASE WHEN EXCLUDED.abilities <> '[]'::jsonb THEN EXCLUDED.abilities ELSE card_print.abilities END,
       retreat_cost     = COALESCE(EXCLUDED.retreat_cost, card_print.retreat_cost),
       is_promo         = card_print.is_promo OR EXCLUDED.is_promo,
       is_digital_only  = card_print.is_digital_only OR EXCLUDED.is_digital_only,
       source_etag      = EXCLUDED.source_etag,
       ingest_status    = 'ok',
       last_ingest_at   = now()
     RETURNING id`,
    [
      cardSetId,
      card.localId,
      prefix,
      num,
      card.sourceId,
      card.supertype ?? null,
      card.subtypes ?? [],
      card.types ?? [],
      card.hp ?? null,
      card.rarity ?? null,
      regMark(card.regulationMark),
      card.nationalPokedex ?? [],
      JSON.stringify(card.variants ?? {}),
      JSON.stringify(card.attacks ?? []),
      JSON.stringify(card.abilities ?? []),
      card.retreatCost ?? null,
      card.isPromo,
      card.isDigitalOnly,
      etag(card.raw),
    ],
  );
  return rows[0]!.id;
}

export async function upsertLocalization(
  client: PoolClient,
  cardPrintId: string,
  lang: Lang,
  card: NormalizedCard,
): Promise<void> {
  await client.query(
    `INSERT INTO card_localization
       (card_print_id, lang, name, illustrator, flavor_text, attacks_text,
        abilities_text, printed_number, source, source_etag)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,'tcgdex',$9)
     ON CONFLICT (card_print_id, lang) DO UPDATE SET
       name           = EXCLUDED.name,
       illustrator    = COALESCE(EXCLUDED.illustrator, card_localization.illustrator),
       flavor_text    = COALESCE(EXCLUDED.flavor_text, card_localization.flavor_text),
       attacks_text   = CASE WHEN EXCLUDED.attacks_text <> '[]'::jsonb THEN EXCLUDED.attacks_text ELSE card_localization.attacks_text END,
       abilities_text = CASE WHEN EXCLUDED.abilities_text <> '[]'::jsonb THEN EXCLUDED.abilities_text ELSE card_localization.abilities_text END,
       printed_number = EXCLUDED.printed_number,
       source_etag    = EXCLUDED.source_etag`,
    [
      cardPrintId,
      lang,
      card.name,
      card.illustrator ?? null,
      card.flavorText ?? null,
      JSON.stringify(card.attacksText ?? []),
      JSON.stringify(card.abilitiesText ?? []),
      card.localId,
      etag({ name: card.name, ill: card.illustrator, flavor: card.flavorText }),
    ],
  );
}

/**
 * Register the TCGdex asset as a HOTLINK image_variant (no bytes stored; Phase 2
 * resolves higher-quality per-language sources + fetch-into-storage). serving_mode
 * 'hotlink' keeps the generate-don't-host posture.
 */
export async function upsertTcgdexImage(
  client: PoolClient,
  cardPrintId: string,
  lang: Lang,
  imageBase: string,
): Promise<void> {
  const remoteUrl = `${imageBase}/high.png`;
  await client.query(
    `INSERT INTO image_variant
       (card_print_id, lang, origin, serving_mode, source_url, remote_url,
        format, quality_rank, ingest_status, fetched_at)
     VALUES ($1,$2,'tcgdex_assets','hotlink',$3,$4,'png',60,'ok',now())
     ON CONFLICT (card_print_id, lang, origin, has_bleed, is_upscaled) DO UPDATE SET
       remote_url    = EXCLUDED.remote_url,
       source_url    = EXCLUDED.source_url,
       ingest_status = 'ok'`,
    [cardPrintId, lang, imageBase, remoteUrl],
  );
}

export interface SyncRunHandle {
  id: number;
}

export async function startSyncRun(client: PoolClient, kind: string): Promise<SyncRunHandle> {
  const { rows } = await client.query<{ id: number }>(
    `INSERT INTO sync_run (kind) VALUES ($1) RETURNING id`,
    [kind],
  );
  return { id: rows[0]!.id };
}

export async function finishSyncRun(
  client: PoolClient,
  run: SyncRunHandle,
  stats: { setsNew: number; setsChanged: number; cardsUpserted: number; errors: unknown[] },
): Promise<void> {
  await client.query(
    `UPDATE sync_run SET finished_at = now(), sets_new=$2, sets_changed=$3,
       cards_upserted=$4, errors=$5::jsonb WHERE id=$1`,
    [run.id, stats.setsNew, stats.setsChanged, stats.cardsUpserted, JSON.stringify(stats.errors)],
  );
}

/** Read the stored fingerprint for a (source, lang:setId) key. */
export async function getSetState(
  client: PoolClient,
  source: string,
  key: string,
): Promise<string | null> {
  const { rows } = await client.query<{ remote_hash: string | null }>(
    `SELECT remote_hash FROM sync_set_state WHERE source=$1 AND source_set_id=$2`,
    [source, key],
  );
  return rows.length ? (rows[0]!.remote_hash ?? null) : null;
}

export async function recordSetState(
  client: PoolClient,
  source: string,
  key: string,
  fingerprint: string,
  cardCount: number,
): Promise<void> {
  await client.query(
    `INSERT INTO sync_set_state (source, source_set_id, remote_hash, card_count, last_synced_at, status)
     VALUES ($1,$2,$3,$4,now(),'ok')
     ON CONFLICT (source, source_set_id) DO UPDATE SET
       remote_hash=EXCLUDED.remote_hash, card_count=EXCLUDED.card_count,
       last_synced_at=now(), status='ok', fail_count=0, last_error=NULL`,
    [source, key, fingerprint, cardCount],
  );
}
