/**
 * Search index CLI (Meilisearch).
 *
 *   npm run search -- reindex                  # refresh card_display MV + full reindex
 *   npm run search -- reindex --no-refresh-mv  # index the MV as-is
 *   npm run search -- reindex --langs en,ja    # subset of languages
 *   npm run search -- reindex --batch 5000
 *   npm run search -- settings                 # (re)apply index settings only
 *   npm run search -- status                   # index health + document count
 *   npm run search -- clear                    # delete the index
 *   npm run search -- search "<query>" [--lang en] [--set base1] [--supertype Pokemon] [--promo] [--page 1]
 *
 * Production note: run `reindex` after each ingest batch so the index tracks the
 * catalog. With SEARCH_BACKEND=meili the web reads from this index.
 */
import { closePool } from '@proxyforge/db';
import { LAUNCH_LANGS } from '@proxyforge/config';
import { INDEX_PREFIX, indexNameForLang, settingsForLang, PRIMARY_KEY } from './document.js';
import { meiliFromConfig } from './index.js';
import { reindexAll } from './reindex.js';
import { searchDocs } from './search.js';

function flagVal(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = argv[i + 1];
  return v && !v.startsWith('--') ? v : undefined;
}
function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(`--${name}`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0] ?? 'status';
  const client = meiliFromConfig();

  switch (cmd) {
    case 'reindex': {
      const langs = flagVal(argv, 'langs')
        ?.split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const batch = flagVal(argv, 'batch');
      const res = await reindexAll(client, {
        refreshMv: !hasFlag(argv, 'no-refresh-mv'),
        ...(langs && langs.length ? { langs } : {}),
        ...(batch ? { batchSize: Number.parseInt(batch, 10) } : {}),
        onProgress: (n) => process.stdout.write(`\r  indexed ${n} docs...`),
      });
      process.stdout.write('\n');
      if (res.indexed === 0) {
        console.log(
          `reindex found 0 rows in card_display. Run an ingest first, e.g.\n` +
            `  npm run ingest -- backfill --full --refresh-mv`,
        );
      } else {
        console.log(`reindex complete: ${res.indexed} documents across '${INDEX_PREFIX}_<lang>' indexes`);
      }
      break;
    }
    case 'settings': {
      for (const lang of LAUNCH_LANGS) {
        const uid = indexNameForLang(lang);
        await client.ensureIndex(uid, PRIMARY_KEY);
        const task = await client.updateSettings(uid, settingsForLang(lang));
        await client.waitForTask(task.taskUid);
        console.log(`settings applied: ${uid}`);
      }
      break;
    }
    case 'status': {
      if (!(await client.health())) {
        console.log('meilisearch: UNREACHABLE (is `docker compose up -d meilisearch` running?)');
        process.exitCode = 1;
        break;
      }
      let total = 0;
      let built = 0;
      for (const lang of LAUNCH_LANGS) {
        const uid = indexNameForLang(lang);
        try {
          const s = await client.stats(uid);
          total += s.numberOfDocuments;
          built += 1;
          console.log(`  ${uid}: docs=${s.numberOfDocuments} indexing=${s.isIndexing}`);
        } catch {
          console.log(`  ${uid}: not built yet`);
        }
      }
      console.log(
        built === 0
          ? `meilisearch: OK  no '${INDEX_PREFIX}_*' indexes built yet (run: npm run search -- reindex)`
          : `meilisearch: OK  ${built}/${LAUNCH_LANGS.length} indexes built, ${total} docs total`,
      );
      break;
    }
    case 'clear': {
      for (const lang of LAUNCH_LANGS) {
        const uid = indexNameForLang(lang);
        const t = await client.deleteIndex(uid);
        if (t) await client.waitForTask(t.taskUid);
        console.log(`index '${uid}' cleared`);
      }
      break;
    }
    case 'search': {
      const q = argv[1] && !argv[1].startsWith('--') ? argv[1] : '';
      const set = flagVal(argv, 'set');
      const supertype = flagVal(argv, 'supertype');
      const page = flagVal(argv, 'page');
      const hits = await searchDocs(client, {
        lang: flagVal(argv, 'lang') ?? 'en',
        q,
        ...(set ? { set } : {}),
        ...(supertype ? { supertype } : {}),
        promoOnly: hasFlag(argv, 'promo'),
        ...(page ? { page: Number.parseInt(page, 10) } : {}),
      });
      console.log(`${hits.total} hits (page ${hits.page}/${hits.totalPages})`);
      for (const d of hits.docs.slice(0, 20)) {
        console.log(
          `  ${d.setId}-${d.collectorNumberRaw}  ${d.name}  [${d.lang}]${d.rarity ? ' · ' + d.rarity : ''}`,
        );
      }
      break;
    }
    default:
      console.error(`unknown command '${cmd}'. try: reindex | settings | status | clear | search`);
      process.exitCode = 1;
  }
  await closePool();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
  void closePool();
});
