/** Build/refresh the per-language Meili indexes from the card_display read-model. */
import { query } from '@proxyforge/db';
import { LAUNCH_LANGS } from '@proxyforge/config';
import type { MeiliClient } from './client.js';
import { indexNameForLang, settingsForLang, PRIMARY_KEY, rowToDoc } from './document.js';

const SELECT_COLS = `
  cd.card_print_id, cd.requested_lang, cd.set_id, cd.slug,
  cd.collector_number_raw, cd.collector_prefix, cd.collector_number_num,
  cd.display_name, cd.name_en, cd.name_is_fallback, cd.name_lang, cd.illustrator,
  cd.image_key, cd.image_remote_url, cd.image_served_mode, cd.image_lang,
  cd.dpi_at_trim, cd.is_watermarked, cd.is_upscaled, cd.has_localized_image,
  cd.supertype, cd.subtypes, cd.types, cd.hp, cd.rarity, cd.rarity_display,
  cd.regulation_mark, cd.national_pokedex,
  cd.is_promo, cd.is_jumbo, cd.is_error, cd.is_regional_excl, cd.is_sealed_only,
  cs.release_date, extract(epoch from cs.release_date)::bigint AS release_ts`;

export interface ReindexOptions {
  /** REFRESH MATERIALIZED VIEW card_display first (default true). */
  refreshMv?: boolean;
  /** Limit to these requested_langs (default: all). */
  langs?: string[];
  /** Rows per Meili upsert batch (default 2000). */
  batchSize?: number;
  onProgress?: (indexed: number) => void;
}

export interface ReindexResult {
  indexed: number;
}

/**
 * Refresh the read-model (optional), then (re)index every card_display row into
 * Meili using keyset pagination so memory stays flat regardless of catalog size.
 */
export async function reindexAll(
  client: MeiliClient,
  opts: ReindexOptions = {},
): Promise<ReindexResult> {
  const refreshMv = opts.refreshMv ?? true;
  const batchSize = Math.max(1, opts.batchSize ?? 2000);
  const langs = opts.langs && opts.langs.length ? opts.langs : null;

  if (refreshMv) {
    await query('REFRESH MATERIALIZED VIEW card_display');
  }

  // Ensure + configure one index per target language up front (CJK locales).
  const targetLangs = langs ?? [...LAUNCH_LANGS];
  for (const lang of targetLangs) {
    const uid = indexNameForLang(lang);
    await client.ensureIndex(uid, PRIMARY_KEY);
    const settingsTask = await client.updateSettings(uid, settingsForLang(lang));
    await client.waitForTask(settingsTask.taskUid);
  }

  let indexed = 0;
  let lastId: string | null = null;
  let lastLang: string | null = null;
  let lastTaskUid: number | null = null;

  for (;;) {
    const params: unknown[] = [];
    const conds: string[] = ['TRUE'];
    if (langs) conds.push(`cd.requested_lang = ANY($${params.push(langs)}::text[])`);
    if (lastId !== null) {
      const a = params.push(lastId);
      const b = params.push(lastLang);
      conds.push(`(cd.card_print_id, cd.requested_lang) > ($${a}::uuid, $${b}::text)`);
    }
    const lim = params.push(batchSize);
    const sql = `
      SELECT ${SELECT_COLS}
      FROM card_display cd
      JOIN card_set cs ON cs.id = cd.card_set_id
      WHERE ${conds.join(' AND ')}
      ORDER BY cd.card_print_id, cd.requested_lang
      LIMIT $${lim}`;
    const res = await query<Record<string, unknown>>(sql, params);
    if (res.rows.length === 0) break;

    const docs = res.rows.map(rowToDoc);
    // route each doc to its language's index
    const byLang = new Map<string, typeof docs>();
    for (const doc of docs) {
      const list = byLang.get(doc.lang) ?? [];
      list.push(doc);
      byLang.set(doc.lang, list);
    }
    for (const [lang, langDocs] of byLang) {
      const task = await client.addDocuments(indexNameForLang(lang), langDocs, PRIMARY_KEY);
      lastTaskUid = task.taskUid; // Meili's task queue is global FIFO
    }
    indexed += docs.length;
    opts.onProgress?.(indexed);

    const last = res.rows[res.rows.length - 1]!;
    lastId = String(last.card_print_id);
    lastLang = String(last.requested_lang);
    if (res.rows.length < batchSize) break;
  }

  // Tasks run FIFO: once the final enqueue succeeds, every prior batch is done.
  if (lastTaskUid !== null) {
    await client.waitForTask(lastTaskUid, { timeoutMs: 600_000 });
  }
  return { indexed };
}
