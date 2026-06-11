# Testing

`npm test` runs every `packages/**/test/*.test.ts` via `node --test` (tsx
loader). `npm run check` = typecheck + test + brand-lint + gpl-check. No network
or services are needed for the default suite.

## Layers

1. **Unit tests** - pure functions (geometry, decklist parser, set-matcher,
   coverage rollup, config, search request builder, ...).
2. **PGlite integration tests** (`*.integration.test.ts`) - the real
   `db/schema.sql` loaded into an in-process WASM Postgres (`@electric-sql/pglite`,
   a dev dependency). **No Docker, no service, no `DATABASE_URL`.** These prove
   the schema, the `card_display` materialized view, triggers, and the actual
   SQL (coverage, decklist resolution, the image-write upsert, the natural-key
   collapse, the per-language reindex).
3. **Network-gated tests** - hit live third-party APIs; off by default, run with
   `npm run test:net` (`PPF_RUN_NET_TESTS=1`). Only the TCGdex-live adapter tests.

## Writing a PGlite integration test

Load the schema (PGlite supports every feature except `pg_bigm`, so strip its
extension + the 5 bigram indexes - nothing under test uses them):

```ts
const sql = readFileSync(SCHEMA_PATH, 'utf8')
  .split('\n').filter((l) => !/pg_bigm|gin_bigm_ops/.test(l)).join('\n');
const db = new PGlite({ extensions: { pg_trgm, citext, pgcrypto } });
await db.exec(sql);
```

Then exercise the code one of two ways:

- **Inject PGlite as `@proxyforge/db`'s query runner** to test the REAL data
  functions (their bigint->number coercion, batching, mapping):

  ```ts
  import { __setTestQueryRunner } from '@proxyforge/db';
  __setTestQueryRunner(db);            // route query() at PGlite (TEST ONLY)
  try { const rows = await getCoverage(); /* assert */ }
  finally { __setTestQueryRunner(null); await db.close(); }
  ```

- **Pass PGlite directly as the `client`** for functions that already take one
  (the ingest repo upserts): `upsertCardPrint(db as unknown as PoolClient, ...)`.

## Deterministic seams (no real time / network / services)

These are injectable so the timing/IO branches are tested without flakiness:

- `RateLimiter(rps, { now, sleep })` - a fake clock verifies the min-interval
  spacing (the "never hammer sources" guarantee) deterministically.
- `fetchImageBytes(url, { fetchImpl })` - a fake fetch covers 404->null, non-2xx
  throw, and the content-type default.
- `MeiliClient({ ..., fetchImpl })` - canned `Response`s test json/error/task
  handling; `reindexAll` / `searchDocs` take a `client`, so a recording fake
  proves doc routing and response mapping.
- `loadConfig(env)` / `loadCompliance(env)` - pass an env object; they no longer
  read `process.env` directly.

## CI

`.github/workflows/ci.yml`: `lint-type-test` (the suite, incl. PGlite
integration), `web-build` (Next.js), and `migrate-smoke` - which builds the
custom Postgres + **pg_bigm** image and applies `schema.sql` against a real
`postgres:16` so the CJK bigram path PGlite can't run is still covered.
