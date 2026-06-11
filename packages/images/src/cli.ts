/**
 * Image pipeline CLI - fetch best per-language images into storage, and report
 * per-set/per-language coverage.
 *
 *   npm run images -- fetch                       # all langs, up to 500
 *   npm run images -- fetch --langs en,ja --limit 50
 *   npm run images -- fetch --no-en-hires         # skip third-party hi-res
 *   npm run images -- coverage                    # per-(set,lang) coverage table
 *   npm run images -- coverage --langs en,ja --format json
 *
 * Storage backend: STORAGE_BACKEND=local (default) writes under data/images;
 * IMAGES_DIR overrides the path. S3/SeaweedFS backend is the production option.
 */
import { loadConfig, type Lang, LAUNCH_LANGS } from '@proxyforge/config';
import { closePool } from '@proxyforge/db';
import { runImagePipeline, type ImagePipelineOptions } from './pipeline.js';
import { getCoverage, formatCoverageTable, rollupByLang } from './coverage.js';

function flagVal(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

function parseLangs(argv: string[]): Lang[] | undefined {
  const langArg = flagVal(argv, 'langs');
  if (!langArg) return undefined;
  const allowed = new Set(LAUNCH_LANGS as readonly string[]);
  return langArg.split(',').map((s) => s.trim()).filter((s) => {
    if (!allowed.has(s)) throw new Error(`unknown lang '${s}'`);
    return true;
  }) as Lang[];
}

async function runCoverage(argv: string[]): Promise<void> {
  const langs = parseLangs(argv);
  const rows = await getCoverage(langs);
  if (flagVal(argv, 'format') === 'json') {
    console.log(JSON.stringify({ perSet: rows, perLang: rollupByLang(rows) }, null, 2));
    return;
  }
  console.log(formatCoverageTable(rows));
  console.log('\n== totals per language ==');
  console.log(formatCoverageTable(rollupByLang(rows)));
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0] ?? 'fetch';
  if (cmd === 'coverage') return runCoverage(argv);
  if (cmd !== 'fetch') throw new Error(`unknown command '${cmd}' (use: fetch | coverage)`);

  const opts: ImagePipelineOptions = {};
  opts.langs = parseLangs(argv) ?? loadConfig().launchLangs;
  const limit = flagVal(argv, 'limit');
  if (limit) opts.limit = Number.parseInt(limit, 10);
  if (argv.includes('--no-en-hires')) opts.enHires = false;

  console.log(`[images] fetch langs=${opts.langs?.join(',')} limit=${opts.limit ?? 500}`);
  const stats = await runImagePipeline(opts);
  console.log('[images] done:', JSON.stringify(stats, null, 2));
  if (stats.errors.length) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error('[images] FATAL:', err instanceof Error ? err.stack : err);
    process.exitCode = 1;
  })
  .finally(() => void closePool());
