# DB notes, fixes, and known refinements

`schema.sql` is the canonical, single source of truth for the data layer
(`packages/db/src/migrate.ts` applies it verbatim). It targets **Postgres 16 +
pg_bigm** (build the image from `db/Dockerfile`).

## Fixes already applied to schema.sql

1. **`normalize_collector_number` regex (CRITICAL, fixed).**
   The original `regexp_replace(s,'0+([0-9])','\1','g')` stripped zeros
   *anywhere*, so `'100' -> '10'`, colliding with card `'10'` on the natural key
   `uq_card_print_natural (card_set_id, collector_number_norm)`. Any set with
   >=100 cards would fail ingest. Now anchored: `'(^|[^0-9])0+([0-9])' -> '\1\2'`,
   which strips only leading / after-separator zeros and keeps interior zeros
   (`'100' -> '100'`, `'001' -> '1'`, `'gg01' -> 'gg1'`, `'sv-p-001' -> 'sv-p-1'`).
   Mirrored exactly in `packages/ingest/src/normalize.ts` (unit-tested).

## Open refinements (Phase 3+, NOT yet changed in schema.sql)

These are intentionally deferred so the canonical DDL stays the reviewed artifact
until the relevant phase. Track here; apply when building search/print.

1. **`card_display` MV drops imageless cards (Phase 3).**
   `best` is joined with `CROSS JOIN LATERAL ... LIMIT 1`. A `card_print` with no
   `image_variant` (no localized scan AND no EN scan) produces zero `best` rows and
   is therefore **excluded from the MV entirely** - it would not be searchable.
   For "every card ever printed," change to `LEFT JOIN LATERAL (...) best ON TRUE`
   so imageless cards remain searchable (UI shows a placeholder). Decide when
   wiring Meilisearch.

2. **`card_display` MV scale.** ~23k EN cards x 10 langs (CROSS JOIN) ~= 230k rows
   plus JA/KO/ZH rows. `REFRESH MATERIALIZED VIEW CONCURRENTLY` cost grows with the
   catalog; consider per-language partial MVs or on-demand caching. (Also in the
   architecture's open items.)

3. **Set-name localization.** `card_set` has only `name_en`. Western sets have a
   localized name per language (e.g. "Obsidian Flames" / "Flammes Obsidiennes").
   Phase 1 stores English when available and the first-seen name otherwise. If
   per-language set names matter in the UI, add a `card_set_localization(set_id,
   lang, name)` table. Deferred.

## pg_bigm version

`db/Dockerfile` pins `PG_BIGM_VERSION=1.2-20240606`. Verify it is current at
https://github.com/pgbigm/pg_bigm/releases before the first build; bump the ARG
if needed. The Phase 0 CI migration smoke-test (`.github/workflows/ci.yml`) builds
this image and applies `schema.sql` to catch any drift.
