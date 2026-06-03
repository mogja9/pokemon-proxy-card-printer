/**
 * Image pipeline (Phase 2): take the hotlink rows Phase 1 created, resolve the
 * best per-language source, fetch the bytes ONCE into storage, and upgrade the
 * image_variant row with storage_key + REAL measured width/height (-> dpi_at_trim
 * generated column) + checksum. EN gets a higher-quality pokemontcg.io row added.
 */
import type { Lang } from '@proxyforge/config';
import { query } from '@proxyforge/db';
import { createStorage, type Storage } from './storage.js';
import { resolveSources } from './sources.js';
import { fetchImageBytes, probeImage, sha256, dpiAtTrim } from './fetch.js';

export interface ImagePipelineOptions {
  langs?: Lang[];
  limit?: number;
  /** allow the pokemontcg.io EN hi-res CDN (~296 DPI). default true. */
  enHires?: boolean;
  storage?: Storage;
}

export interface ImagePipelineStats {
  considered: number;
  stored: number;
  upgradedToHires: number;
  skipped: number;
  errors: { cardPrintId: string; lang: Lang; error: string }[];
}

interface PendingRow {
  card_print_id: string;
  lang: Lang;
  tcgdex_base: string | null;
  set_id: string;
  local_id: string;
}

/** (card,lang) rows that still need a stored (non-hotlink) image. */
async function selectPending(langs: Lang[] | undefined, limit: number): Promise<PendingRow[]> {
  const params: unknown[] = [];
  // a (card,lang) still needs work if its tcgdex hotlink row has no bytes AND no
  // other origin (e.g. the EN pokemontcg.io hi-res) has already stored it.
  let where =
    `iv.origin = 'tcgdex_assets' AND iv.storage_key IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM image_variant s
       WHERE s.card_print_id = iv.card_print_id AND s.lang = iv.lang
         AND s.storage_key IS NOT NULL
     )`;
  if (langs && langs.length) {
    params.push(langs);
    where += ` AND iv.lang = ANY($${params.length})`;
  }
  params.push(limit);
  const { rows } = await query<PendingRow>(
    `SELECT iv.card_print_id, iv.lang, iv.source_url AS tcgdex_base,
            cs.set_id, cp.collector_number_raw AS local_id
     FROM image_variant iv
     JOIN card_print cp ON cp.id = iv.card_print_id
     JOIN card_set  cs ON cs.id = cp.card_set_id
     WHERE ${where}
     ORDER BY iv.card_print_id
     LIMIT $${params.length}`,
    params,
  );
  return rows;
}

async function upsertStored(args: {
  cardPrintId: string;
  lang: Lang;
  origin: string;
  storageKey: string;
  remoteUrl: string;
  width: number;
  height: number;
  hasAlpha: boolean;
  checksum: string;
  byteSize: number;
  qualityRank: number;
}): Promise<void> {
  await query(
    `INSERT INTO image_variant
       (card_print_id, lang, origin, serving_mode, source_url, remote_url, storage_key,
        format, width_px, height_px, has_transparent_corners, checksum_sha256, byte_size,
        quality_rank, ingest_status, fetched_at)
     VALUES ($1,$2,$3::image_origin,'cache',$5,$5,$4,'png',$6,$7,$8,$9,$10,$11,'ok',now())
     ON CONFLICT (card_print_id, lang, origin, has_bleed, is_upscaled) DO UPDATE SET
       serving_mode  = 'cache',
       storage_key   = EXCLUDED.storage_key,
       remote_url    = COALESCE(image_variant.remote_url, EXCLUDED.remote_url),
       width_px      = EXCLUDED.width_px,
       height_px     = EXCLUDED.height_px,
       has_transparent_corners = EXCLUDED.has_transparent_corners,
       checksum_sha256 = EXCLUDED.checksum_sha256,
       byte_size     = EXCLUDED.byte_size,
       quality_rank  = EXCLUDED.quality_rank,
       ingest_status = 'ok',
       fetched_at    = now()`,
    [
      args.cardPrintId, // 1
      args.lang, // 2
      args.origin, // 3
      args.storageKey, // 4
      args.remoteUrl, // 5 (source_url + remote_url)
      args.width, // 6
      args.height, // 7
      args.hasAlpha, // 8
      args.checksum, // 9
      args.byteSize, // 10
      args.qualityRank, // 11
    ],
  );
}

export async function runImagePipeline(
  opts: ImagePipelineOptions = {},
): Promise<ImagePipelineStats> {
  const storage = opts.storage ?? createStorage();
  const limit = opts.limit ?? 500;
  const pending = await selectPending(opts.langs, limit);
  const stats: ImagePipelineStats = {
    considered: pending.length,
    stored: 0,
    upgradedToHires: 0,
    skipped: 0,
    errors: [],
  };

  for (const row of pending) {
    const candidates = resolveSources({
      setId: row.set_id,
      localId: row.local_id,
      lang: row.lang,
      tcgdexImageBase: row.tcgdex_base,
      ...(opts.enHires !== undefined ? { enHires: opts.enHires } : {}),
    });
    if (!candidates.length) {
      stats.skipped += 1;
      continue;
    }

    let done = false;
    for (const cand of candidates) {
      try {
        const fetched = await fetchImageBytes(cand.url);
        if (!fetched) continue; // 404 -> next candidate
        const meta = await probeImage(fetched.bytes);
        const checksum = sha256(fetched.bytes);
        const key = `src/${cand.origin}/${cand.lang}/${row.set_id}/${row.local_id}.png`;
        await storage.put(key, fetched.bytes, fetched.contentType);
        await upsertStored({
          cardPrintId: row.card_print_id,
          lang: row.lang,
          origin: cand.origin,
          storageKey: key,
          remoteUrl: cand.url,
          width: meta.width,
          height: meta.height,
          hasAlpha: meta.hasAlpha,
          checksum,
          byteSize: fetched.bytes.length,
          qualityRank: cand.qualityRank,
        });
        stats.stored += 1;
        if (cand.origin === 'pokemontcg_io') stats.upgradedToHires += 1;
        done = true;
        if (cand.lang === row.lang) break; // got the requested-lang image
      } catch (err) {
        stats.errors.push({
          cardPrintId: row.card_print_id,
          lang: row.lang,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (!done) stats.skipped += 1;
  }

  return stats;
}
