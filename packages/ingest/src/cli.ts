/**
 * Ingestion CLI.
 *
 *   npm run ingest -- backfill                      # all langs, brief mode
 *   npm run ingest -- backfill --full               # rich per-card fetch
 *   npm run ingest -- backfill --langs en,ja --limit-sets 2   # dev slice
 *   npm run ingest -- incremental                   # only new/changed sets
 *   npm run ingest -- backfill --refresh-mv         # refresh card_display after
 *
 * Production note: point TCGDEX_BASE_URL at your self-hosted tcgdex clone so a
 * --full backfill does not hammer the public API.
 */
import { loadConfig, type Lang, LAUNCH_LANGS } from '@proxyforge/config';
import { closePool } from '@proxyforge/db';
import { createSpineAdapter } from './index.js';
import { backfill, incremental, type IngestOptions } from './backfill.js';

function parseArgs(argv: string[]): { cmd: string; opts: IngestOptions } {
  const cmd = argv[0] ?? 'backfill';
  const cfg = loadConfig();
  const flags = new Map<string, string>();
  const bools = new Set<string>();
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      flags.set(key, next);
      i++;
    } else {
      bools.add(key);
    }
  }

  let langs: Lang[] = cfg.launchLangs;
  const langArg = flags.get('langs');
  if (langArg) {
    const allowed = new Set(LAUNCH_LANGS as readonly string[]);
    langs = langArg
      .split(',')
      .map((s) => s.trim())
      .filter((s) => {
        if (!allowed.has(s)) throw new Error(`unknown lang '${s}'`);
        return true;
      }) as Lang[];
  }

  const opts: IngestOptions = {
    langs,
    full: bools.has('full'),
    refreshMv: bools.has('refresh-mv'),
  };
  const limit = flags.get('limit-sets');
  if (limit) opts.limitSets = Number.parseInt(limit, 10);
  return { cmd, opts };
}

async function main(): Promise<void> {
  const { cmd, opts } = parseArgs(process.argv.slice(2));
  const adapter = createSpineAdapter();
  console.log(
    `[ingest] cmd=${cmd} langs=${opts.langs.join(',')} full=${!!opts.full}` +
      (opts.limitSets ? ` limitSets=${opts.limitSets}` : ''),
  );

  const stats =
    cmd === 'incremental' ? await incremental(adapter, opts) : await backfill(adapter, opts);

  console.log('[ingest] done:', JSON.stringify(stats, null, 2));
  if (stats.errors.length) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error('[ingest] FATAL:', err instanceof Error ? err.stack : err);
    process.exitCode = 1;
  })
  .finally(() => void closePool());
