# Pixie-Proxy: Consolidated Architecture & Schema Specification (FINAL, review-corrected)

**A free, open-source, self-hostable website for finding any Pokemon TCG card in every major language and printing playtest proxies at the exact competitive card size.**

Status: build-ready integration of 7 subsystem designs (data-model, ingestion-sync, image-pipeline, search-ux, print-engine, infra-deploy, legal-compliance), with all CRITICAL/MAJOR review findings applied and worthwhile minors incorporated. The canonical PostgreSQL DDL is in the `sqlSchema` field and is the single source of truth for the data layer; it now executes verbatim against `postgres:16-alpine` (the subquery-in-generated-column blocker is removed) and a CI migration smoke-test is mandated in Phase 0. Declined fixes are listed in §12.

---

## 1. Overview + the SIZE-vs-DPI clarification (read this first)

Pixie-Proxy lets a user search the entire Pokemon TCG corpus across 10 launch languages (`en, ja, fr, de, it, es, pt, ko, zh-cn, zh-tw` - note `pt` is Portugal Portuguese, **not** `pt-br`), build a print list, and download either a home-print PDF or an MPC-ready ZIP. It is non-commercial: donations are accepted (Ko-fi / GitHub Sponsors / Liberapay) but cards are **never** sold or shipped. Every operating dependency is FOSS and self-hostable; where "free" means a free *tier with limits*, that is called out explicitly in §3 and §9.

### Card SIZE vs DPI - two independent axes

- **SIZE is FIXED. Always 63 x 88 mm = 2.4803 x 3.4646 in.** Universal competitive/standard TCG card size. Hardcoded constant. Never stored per-row, never user-editable, never derived from a parameter. A proxy is 63x88 mm whether rendered from a tiny image or a huge one. Footgun: the Japanese "small" size is 59x86 mm - Pokemon does **not** use it. In silhouette-card-maker this is the `standard` profile, never `japanese`.
- **DPI is SEPARATE and variable. It is image sharpness (pixel density), not size.** A 63x88 mm card is **744x1039 px at 300 DPI** and **1488x2079 px at 600 DPI** - same physical millimetres, more pixels. DPI is the only quality dial the user touches. It is stored **per image** (`image_variant.dpi_at_trim`, a generated column = `round(height_px / 3.46456692913, 1)`) so the UI honestly labels what a source will print at.

**Master conversion - the only place DPI touches geometry:** `px = round(mm / 25.4 * DPI)`. Everything else is computed in millimetres (the source of truth) and converted at the boundary. (Correction applied: the 88 mm trim height rounds to **1039 px @300 / 2079 px @600**, not 1038/2076 - the earlier numbers contradicted the formula and would self-label as 299.6/599.2 DPI.)

Verified honest DPI tiers (computed against the fixed 88 mm = 3.46457 in trim height):

| Source | Native px | DPI-at-trim | Label shown to user |
|---|---|---|---|
| JA pokemon-card.com / KR pokemonkorea | 868x1212 | ~350 | "~350 JP/KR (native, highest)" |
| EN pokemontcg.io `_hires` / **malie.io** | 733x1024 | ~296 | "~296 EN (native)" |
| TCGdex localized `high.png` / legacy EN | 600x825 | ~242 | "~242 regional/legacy" |
| Real-ESRGAN x4 → resized to 600-DPI trim | 1488x2079 | ~600 | "~600 (AI upscaled - not original)" |

(`242` is the conventional label for the 600x825 tier; exact arithmetic against 88 mm yields ~238, bucketed honestly as "~242". The upscale row is the **resized-to-trim** target, not the raw ESRGAN output - see §6.5.)

---

## 2. System architecture (ASCII)

```
                                       +-------------------- INGEST PLANE (offline / cron) ----------------------+
                                       |                                                                          |
  tcgdex/cards-database (MIT, Docker)  |   +--------------+   SourceAdapter interface   +--------------------+   |
  self-hosted bulk dump  ---------------> |  TCGdex       | -- NormalizedSet/Card DTO ->|   merge core        |   |
  (the SPINE, never hammer live API)   |   |  Adapter      |                             |  (dedup + upsert)   |   |
                                       |   |  (isSpine)    |                             |  id-normalize       |   |
  pokemontcg.io v2 (DEPRECATED:        |   |  PtcgioAdapter| -- EN enrich (DISABLED ----->|  set-matcher        |   |
   merged into paid Scrydex; OFF by    |   |  (overlay,    |    by default,             |  card-matcher        |   |
   default; OVERLAY_ADAPTER=none) -------->| may vanish)   |    OVERLAY_ADAPTER=none)    |  source_etag idemp.  |   |
                                       |   +--------------+                             +---------+----------+   |
  Bulbapedia / RubenMisprints / Pokeos |   curated promo_tail/*.yaml ---------------------------+              |
  (hand-curated promo/error tail)      |                                                         v              |
                                       |                              +------------- PostgreSQL 16 -----------+  |
                                       |                              | series->card_set->card_print->card_loc.|  |
                                       |   image-resolver --------->  | set_mapping image_variant card_price   |  |
                                       |   (per card,lang priority)   | card_print_review app_user print_list  |  |
                                       |        |                     | print_job blocked_asset takedown_log   |  |
                                       |        v                     +-------+--------------------+----------+  |
                                       |  fetch/scrape workers (BullMQ)       | reindex events     | render jobs  |
                                       |  rate-limit . browser-UA . neg-cache | (lang dirty)       | (pg-boss/Bull)|
                                       |        | fetch-ONCE                  v                    v              |
                                       |        v                     +--------------+   +------------------+    |
                                       |  +--------------+            | Meilisearch  |   | render WORKER     |    |
                                       |  | SeaweedFS    |            | 1 index/lang |   | sharp+pdf-lib /   |    |
                                       |  | (Apache-2.0) |            | federated    |   | reportlab+Pillow  |    |
                                       |  | S3 SoT       |            | /multi-search|   | bleed . N-up .    |    |
                                       |  | src/ + drv/  |            +------+-------+   | MPC xml . upscale |    |
                                       |  +------+-------+                   |           +---------+----------+    |
                                       +---------+--------------------------+---------------------+--------------+
                                                 |                          |                     |
   ===================================== SERVE PLANE (request-time) =======+=====================+==============
                                                 v                          v                     v
                              +----------+  +----------+            +--------------+      +--------------+
   browser -- HTTPS -> Caddy ->| Next.js  |->| Fastify  |--------->| search/cards |      | artifacts/    |
   (auto-TLS, /api,  | web SSR |  | API/BFF  |   read         API->| facets       |      | {job}.pdf/.zip|
    /img, /)         | i18n x10|  | pg-boss/ |                      +--------------+      +------+-------+
                     +----+-----+  | BullMQ   |                                                  | presigned GET
                          |        +----------+                                           short-TTL signed URL
                          v                                                                       v
                    +----------+   img.<host>/v/{print_id}/{lang}/{preset}.{fmt}            download to user
                    | imgproxy | <-- resolves print_id+lang -> image_variant.storage_key
                    +----+-----+     (or remote_url for hotlink) -> signs SeaweedFS source URL
                         v (optional, hot images only)
                  Cloudflare R2 / CDN  (zero-egress cache; NOT system of record)
                  fronted by CF edge cache so most reads never count as R2 Class B ops

   HOST: single docker-compose on one box -> Oracle Always-Free ARM (4 OCPU/24GB/200GB/10TB) OR home server.
   COMPLIANCE: compliance.config.ts gates image route (451 on blocked_asset), fronts-only default,
               pricing OFF by default, noindex, GPL-3 isolation, generate-don't-host.
```

---

## 3. The all-FREE tech stack

| Slot | Pick (FOSS) | License | "Free" honesty |
|---|---|---|---|
| Frontend + SSR | **Next.js 15 App Router** (standalone) + **next-intl** (10 locales) | MIT | $0 |
| API / BFF | **Fastify** (Node 22, TS) | MIT | $0 |
| Relational DB | **PostgreSQL 16** (`postgres:16-alpine`) + contrib `pgcrypto`, `pg_trgm`, `citext`, **`pg_bigm`** (CJK FTS) | PostgreSQL/BSD | $0 |
| Object storage (system of record) | **SeaweedFS** (S3 API, single-binary, self-host-first) | **Apache-2.0** | $0 - **swapped from MinIO** (see note) |
| CDN-cache for hot images (optional) | **Cloudflare R2** behind Cloudflare CDN, in front of imgproxy | proprietary free tier | $0 to 10 GB storage + **zero egress + 1M Class A + 10M Class B ops/mo**; over = $0.015/GB-mo, $4.50/M Class A, $0.36/M Class B → cache only, edge-cache to keep reads off R2 |
| Search engine | **Meilisearch v1.10+** (charabia CJK: jieba/lindera/Korean) | MIT | $0 |
| Search fallback (one-process path) | **Postgres FTS** (`tsvector` GIN, Latin) + **`pg_bigm`** GIN (CJK bigram) behind `SearchProvider` | PostgreSQL / **pg_bigm BSD-3** | $0; honestly **degraded recall** vs Meilisearch, but real CJK coverage (not trigram-only) |
| Queue + cache + rate-limit | **Valkey 8** (BSD; chosen over Redis SSPL) + **BullMQ** (renders/scrape) and/or **pg-boss** (on Postgres, no extra daemon) | BSD-3 / MIT | $0 |
| On-the-fly image transforms | **imgproxy** (libvips) | MIT | $0 |
| Heavy raster (bleed synth, N-up, MPC PNGs) | **sharp** (Node, libvips) **or Pillow** (Python) | Apache-2.0 / HPND | $0 |
| Vector PDF (home print) | **pdf-lib** (Node) **or reportlab** (Python) | MIT / BSD | $0; reference **Alan-Cha/silhouette-card-maker** (MIT) for layout |
| Embeddable fonts (PDF/ZIP footer, 10 langs incl. CJK+KR) | **Noto Sans** + **Noto Sans CJK (SC/TC/JP/KR)** | **OFL-1.1** | $0; OFL permits embedding - license-clean across all 10 langs |
| Optional upscaler | **Real-ESRGAN-ncnn-vulkan** (CPU-only on arm64) | BSD-3 | $0, no GPU needed |
| Reverse proxy + TLS | **Caddy 2** (auto Let's Encrypt) | Apache-2.0 | $0 |
| Migrations | **golang-migrate** or **node-pg-migrate** (raw SQL); the `sqlSchema` file IS the migration | MIT/Apache | $0; **Drizzle = query-builder/types only, not migration source of truth** (does not round-trip DOMAIN/MV/generated cols) |
| Backups | **pg_dump -Fc + restic** → 2nd disk (primary $0 path) and/or Backblaze B2 (off-site) | BSD-2 / free tier | restic $0; **B2 free = 10 GB storage + ~1 GB/day free egress + transaction caps; a full restore drill may briefly incur ~$0.01/GB egress** |
| CI/CD + registry | **GitHub Actions** + **GHCR** | free tier | **public repo = fully $0** (unlimited Actions + free public images); if private, see §9 conflict note |
| Orchestration | **Docker + docker-compose** | Apache-2.0 | $0 |
| Observability (optional) | **Uptime Kuma**, **Dozzle**, **GlitchTip** | MIT | $0 self-host |
| Donations | **Ko-fi + GitHub Sponsors + Liberapay** (static links only) | - | $0; no payment code on our servers |
| EN-hires image mirror (de-facto default once ptcgio sunsets) | **malie.io** PNG (byte-identical to ptcgio `_hires`) | third-party mirror | $0 hotlink; **availability/terms unverified - load-bearing for the $0 EN path; track in §12** |
| Pricing (OFF by default) | adapter for pokemontcg.io/Cardmarket | - | **disabled** by default; see §10 |
| Host | **Oracle Always-Free ARM Ampere A1** *or* home server | free / electricity | the one real asterisk - see §9 |

**Why SeaweedFS replaces MinIO (free-compliance fix).** MinIO Community Edition had its admin/management web console stripped in 2025 (bucket/IAM/policy/monitoring UI moved to paid AIStor Enterprise, ~$96k/yr); the old "MinIO console behind basic-auth" deploy control no longer exists in the free build, and MinIO is AGPL-3.0 (network-service obligations under §13 attach to *modified* deployments). SeaweedFS is **Apache-2.0**, single-binary, self-host-first, S3-compatible, with no enterprise-upsell-gutted UI and no AGPL question. Buckets are managed via `s3cmd`/`aws-cli`/IaC; there is no reliance on a vendor admin console. (Garage AGPL or Zenko CloudServer Apache are acceptable alternatives; SeaweedFS is the shipped pick.)

**pokemontcg.io is DEPRECATED, not a live default.** It has merged into paid Scrydex ("now part of Scrydex"). It is demoted everywhere to *deprecated / best-effort, may vanish*. **`OVERLAY_ADAPTER=none` is the SHIPPED default** - a fully-$0 path because TCGdex already carries EN text and `high.png` images, with the **malie.io mirror** (~296 DPI, byte-identical to the old `_hires` asset) as the EN-hires source. Do not make pokemontcg.io a hard dependency in any phase. A `ScrydexAdapter` is the future drop-in if a free path reappears.

**The single paid temptations are all defaulted OFF or behind swappable adapters:** overlay enrichment (`none`), pricing (off), R2/B2 above their caps, and a VPS if Oracle capacity is unavailable.

---

## 4. Data model overview (see the `sqlSchema` field for the canonical DDL)

The full reconciled PostgreSQL 16 DDL is in `sqlSchema` and **executes verbatim** (the prior `public_slug` generated-column-with-subquery blocker is removed; a Phase-0 CI smoke-test applies it to a clean `postgres:16-alpine`).

### Hierarchy
`series → card_set → card_print → card_localization`, plus side tables for cross-source mapping, card-level review, images, pricing, users/lists/jobs, and compliance.

### The natural key (cross-language anchor) - reconciled and pinned
A **physical card is ONE `card_print` row** keyed by `UNIQUE (card_set_id, collector_number_norm)`. **`collector_number_norm` stores the NORMALIZED form** (trim, lowercase, strip leading zeros before a digit, remove spaces: `'001'→'1'`, `'TG 12'→'tg12'`, `'GG01'→'gg1'`) - this is what makes the key language-agnostic so a JA `'001'` and an EN `'1'` for the same physical card collapse to one row. The **raw/printed form is kept separately in `collector_number_raw`** for display. A `BEFORE INSERT/UPDATE` trigger derives `collector_number_norm` from `collector_number_raw` so ingest cannot insert an un-normalized key. Languages attach as `card_localization` children; images attach as `image_variant` children (each tagged with its own `lang`). Dedup-across-languages is therefore a **structural invariant, not application logic** (this directly fixes the silent-duplicate-rows hazard the review flagged as critical).

### Conflicts resolved across subsystems
1. **`card_print` primary key type = `uuid`** (stable, non-guessable, no sequence contention). `tcgdex_id`/`ptcg_id` are cross-source text keys; a plain trigger-populated `slug` (`set_id || '-' || collector_number_raw`, e.g. `me04-001`, `NOT NULL` + `UNIQUE`) gives human/SEO URLs. **The invalid `public_slug` generated column and its self-DROP are gone.**
2. **One `image_variant` table** is the canonical asset ledger; `image_source_candidate` is the resolver scratchpad. `card_localization` keeps **metadata only** (no art bytes; enforced by COMMENT). `image_variant` now carries **`source_etag`** so the uniform idempotent upsert (`WHERE source_etag IS DISTINCT FROM EXCLUDED`) applies to it too.
3. **`card_set`** is canonical everywhere (not the reserved-ish `set`).
4. **Column naming** standardized: `collector_number_norm` / `collector_number_raw`, `card_set_id`, `card_print_id`, `lang` (a `lang_code` citext domain), `collector_prefix` + `collector_number_num` for natural sort.
5. **Canonical set id = TCGdex zero-padded** (`me04`, `me02.5`, `sv03.5`). The pokemontcg.io unpadded form lives **only** in `set_mapping` - the **redundant `card_set.ptcg_set_id`/`tcgdex_set_id` columns are removed** so there is a single provenance-bearing source of truth for foreign ids (fixes the drift defect).
6. **Storage posture: legal wins - default `serving_mode='ephemeral'`** (isolated bucket, hard 7-day TTL + auto-purge), now **enforced by a CHECK** tying `ephemeral` to a non-NULL `expires_at` and a trigger defaulting `expires_at = now()+7d`. `cache`/`generate`/`hotlink` are opt-in.
7. **Search:** Meilisearch is default; **Postgres FTS + pg_bigm** is the documented one-process fallback behind a shared `SearchProvider`. The `card_display` materialized view feeds Meilisearch reindexing and powers the FTS fallback, and now carries `tsvector` + `bigm` indexes and the **full facet/display field set** (subtypes, supertype, rarity display, illustrator, hp, is_error/is_regional_excl) so the reindexer never re-joins.

### English fallback - single authoritative mechanism (dual-mechanism hazard resolved)
The pointer-row pattern and the `english_fallback` enum value are **removed**. English fallback is derived **purely in the read-model**: the `card_display` LATERAL best-pick selects the localized image if present, else the EN image, and sets `image_is_english_fallback = (served_lang <> requested_lang)`. `is_english_fallback` survives only as a **derived output flag on the MV**, never a stored row type.

### Hotlink images are visible to search (critical fix)
JA/KR native ~350-DPI art may default to `hotlink` (`storage_key` NULL, `remote_url` set). The MV LATERAL and `idx_img_best` now select `WHERE (storage_key IS NOT NULL OR remote_url IS NOT NULL)`, and the MV projects a `served_url` + `served_mode` so the serve plane knows whether to hit SeaweedFS or hotlink. The project's marquee high-DPI sources are no longer invisible.

### `has_localized_image` facet (now derivable)
`card_display` materializes `has_localized_image` per (card, requested_lang) = `EXISTS(image_variant iv WHERE iv.card_print_id=cp.id AND iv.lang=requested_lang AND NOT is_english_fallback-derived AND (storage_key OR remote_url))`, pushed to Meilisearch as a filterable attribute - powering "Only cards with a scan in this language."

### Card-level cross-source review queue (promo collisions)
`set_mapping` is set-level; the `SWSH001` vs `001` collision is at the card level. A new **`card_print_review`** table (`card_print_id`, `source`, `foreign_card_id`, `proposed_match uuid`, `confidence`, `status`, `reason`) plus a `card_print.needs_review` flag (partial index) back the manual queue. The matcher writes low-confidence card matches here **instead of upserting a new `card_print`**, so duplicates are prevented by schema, not process. `set_mapping` drops `UNIQUE(card_set_id, source)` (keeping only `UNIQUE(source, foreign_set_id)`) so **many foreign promo subsets can map onto one canonical TCGdex promo set** - the very case the doc claims to handle.

### Name fallback beyond EN (JA-first promos)
`card_display.display_name` now falls back through a priority LATERAL pick of any present localization (`requested → en → ja → …`) rather than `COALESCE(l.name, len.name)` alone, with a `name_is_fallback` flag, so a JA-only promo shows its JA name instead of NULL.

---

## 5. Ingestion & sync

**Spine = self-hosted clone of `tcgdex/cards-database` (MIT, Docker, port 3000).** Ingest from the compiled bulk dump; never hammer the live API. **Overlay = pokemontcg.io v2 (DEPRECATED, OFF by default)** behind a swappable `SourceAdapter` (`OVERLAY_ADAPTER=ptcgio|scrydex|none`, **default `none`**). The fully-$0 EN path is TCGdex EN text + `high.png` + the malie.io hires mirror.

### Adapter contract
`SourceAdapter { name; languages[]; isSpine; listSets(lang); getSet(lang,id); listCards(lang,setId); setFingerprint(set) }` emitting `NormalizedSet`/`NormalizedCard` DTOs (with `imageCandidates[]`). Every adapter computes the **normalized collector key** before upsert.

### ID normalization (verified live, per-series, NOT universal)
- **Set id:** canonical = TCGdex padded. pokemontcg.io → canonical via an explicit Mega-era map (`me4→me04`, `me2pt5→me02.5`, …) plus a learned alias table; **do not blindly zero-pad** (`sv3→sv03` but `swsh1` stays `swsh1`). The set-matcher is authoritative and persists confirmed aliases. `set_mapping.foreign_set_id` is **normalized at write time** (so `me2pt5` and `me2.5` don't create two aliases).
- **Collector number:** `collector_number_norm` = trim, lowercase, strip leading zeros before a digit, remove spaces. `collector_number_raw` keeps the printed form. `collector_prefix` (`'TG'`,`'GG'`,`''`) + `collector_number_num` drive natural sort.

### Set matcher (cascade, highest confidence first)
1. `ptcgoCode` exact (`abbreviation.official` == `ptcgoCode`, e.g. `OBF`).
2. `releaseDate` (normalize separators) + `printedTotal`.
3. `releaseDate` + `total ±3` + name similarity > 0.85.
4. `name_en` + same series.
Persist to `set_mapping`; unmatched TCGdex sets still ingest fully (overlay is optional). Low-confidence card matches go to `card_print_review`.

### Dedup + idempotency
Group by `(canonicalSetId, collectorNumberNorm)` → one `card_print`; each `lang` → one `card_localization`. Every row (including `image_variant`) carries `source_etag` (sha256 of the source payload slice). Upserts are `ON CONFLICT … DO UPDATE … WHERE source_etag IS DISTINCT FROM EXCLUDED.source_etag` so unchanged re-ingests are free. Cross-source ids merge with `COALESCE(existing, new)`. Image bytes are content-addressed by `checksum_sha256` (byte-identical malie.io == ptcgio `_hires` → one object in storage; row-level dedup is best-effort). TCGdex `.jpg` (black-background bug) dropped at ingest. `is_digital_only` (TCG Pocket) flagged and excluded from every proxy query.

### Backfill vs incremental vs promo tail
- **Backfill:** TCGdex Docker clone → series → EN sets/cards (establishes `card_print` rows) → other langs attach localizations → matcher → optional EN overlay (default skipped) → promo tail. `p-limit(4)` local TCGdex.
- **Incremental** (cron `30 3 * * *`): cheap `listSets`, diff by `setFingerprint` against `sync_set_state`, process only new/changed sets. JA-first sets create `card_print` from TCGdex and get EN children later - no special-casing (natural key is language-agnostic; name fallback covers the gap).
- **Promo tail** (weekly): versioned hand-curated `promo_tail/*.yaml` (transcribed metadata from Bulbapedia / RubenMisprints / Pokeos - never bulk-scraped art) upserted via the same idempotent path; spine wins on the next nightly via hash comparison. Accept a 1-6 month lag.

### Failure handling
`p-retry` exponential backoff (5xx/429/network only; 404 terminal). Per-set try/catch + transaction isolation; `sync_set_state.fail_count`; alert after 5 fails. Weekly 10%-sample re-fingerprint drift detection.

---

## 6. Image pipeline (per-language source table + English fallback + optional Real-ESRGAN)

Two planes: **ingest** (resolve → fetch-once → store) and **serve** (imgproxy transforms). All FOSS.

### 6.1 Per-language source priority table

For a `card_print` `(card_set_id, collector_number_norm)` and a requested `lang`, the resolver returns an ordered candidate list; the first HTTP-200, non-blacklisted asset wins. **English image is the universal last-resort fallback.**

| lang | Primary source | Native px / DPI | Fallback chain | Notes |
|---|---|---|---|---|
| **en** | **malie.io** (byte-identical to ptcgio `_hires`); ptcgio only if `OVERLAY_ADAPTER` enabled | 733x1024 / ~296 (legacy 600x825 / ~242) | → TCGdex `en/.../high.png` | dedup by sha256; ptcgio deprecated |
| **ja** | **scraped** pokemon-card.com `{ERA}/{id6}_P_{ROMAJI}.jpg` | 868x1212 / ~350 | → TCGdex `ja/.../high.png` → **EN** | filename NOT constructible; scrape detail page w/ browser UA; opaque corners |
| **fr, de, it, es, pt** | TCGdex `{lang}/.../high.png` | 600x825 / ~242 | → **EN** | `pt` = Portugal, never `pt-br` |
| **zh-tw** | TCGdex `zh-tw/.../high.png` | varies | → asia.pokemon-card.com `/tw`,`/hk` (scrape) → **EN** | heterogeneous catalogs |
| **ko** | pokemonkorea.co.kr `wmimages/{ERA}/{SET}/{SET}_{NNN}.png` (watermarked, needs ERA+UA) | 868x1212 / ~350 | → TCGdex `ko` (usually 404) → **EN** | watermark preserved + flagged; **legal review before enabling as stored source** |
| **zh-cn** | TCGdex `zh-cn` (almost entirely missing) | - | → 52poke MediaWiki API → **EN** | heavy reliance on EN fallback |

**Never** use TCGdex `.jpg` (black background). **Never** reproduce the official card back.

### 6.2 English-IMAGE fallback (graceful, honest - single mechanism)
When a localization has text but no image (true for KO and zh-cn at scale), the `card_localization` row exists (text present) but no localized `image_variant`. The read-model serves the EN image and computes `image_is_english_fallback=true` (no stored pointer rows). UI renders a **visible badge** ("English image - no localized scan available for <Language>"); the DPI label always reflects the *image actually shown* (a KO→EN fallback shows "~296 EN", not "~350"). The canonical resolver (LATERAL best-pick of localized-then-EN, both index-served, hotlink-inclusive) is the `card_display` MV.

### 6.3 Fetch-once + storage
Resilient fetcher (BullMQ, per-host token bucket: 1 req/2s for JA/KR/zh-tw/52poke official hosts, 4 req/s TCGdex assets, browser UA, `p-retry`, 30-day negative cache for 404s). Store the lossless **original** in SeaweedFS under `src/{source}/{lang}/{set_id}/{collector_number_norm}/original.{ext}` (+ sidecar JSON of dims/sha256/flags). The full src path **is** the value stored in `image_variant.storage_key` - so the serve plane has a single addressing scheme. Derivatives go to a disposable `drv/{print_id}/{lang}/{preset}.{ext}`, regenerable anytime.

### 6.4 Serve plane (imgproxy + sharp) - addressing indirection made explicit
The route `https://img.<host>/v/{print_id}/{lang}/{preset}.{fmt}` resolves via `image_variant` (best row for `print_id`+`lang`) to `image_variant.storage_key` (or `remote_url` for hotlink), then signs an imgproxy source URL pointing at that SeaweedFS key (or the upstream host for hotlink). **This lookup is part of the serve-plane contract; `storage_key` is the single addressing scheme** (fixes the print_id-vs-source-path gap). **imgproxy** does resize/format/quality/WebP only - `w/q/fmt` affect **DPI/sharpness only**; physical size is fixed by the print engine.

**Presets** (note: renamed from "variant" to avoid the line-identity collision in §7): `grid` (245x342 WebP q72), `grid@2x`, `detail` (600x825 WebP), `full` (native), `print300` → bleed service (822x1122), `print600` (1644x2244), `print300nb` (**744x1039** trim-only). imgproxy cannot do mirror/edge-extend bleed or transparent-corner compositing, so `print*` presets route to a **sharp** microservice (§8).

### 6.5 Optional free Real-ESRGAN upscale (flagged) - corrected scale math
`realesrgan-ncnn-vulkan` supports **integer scale factors only** (`-s 2|3|4`). The pipeline is **two-step**: ESRGAN integer-upscale **then Lanczos resize/fit to the exact trim box**. For a legacy 600x825 source targeting `print600`: `realesrgan-x4plus` (600x825 → 2400x3300) → resize to **1488x2079** (~600 DPI). It is **not** a "2x upscale" (2x of 600x825 = 1200x1650, which would not reach the 600-DPI trim target). Async, opt-in, gated to low-res sources (`native_w < threshold`). Stored as a separate `image_variant` with `is_upscaled=true`; UI **must** badge "Upscaled (AI) - not original print resolution." Never upscale native JA 868x1212. Order for a low-res `print600`: upscale the **art** first, then synthesize bleed.

### 6.6 Hotlink-vs-cache posture
Per-source `serving_mode` flag, default **ephemeral** (7-day TTL isolated bucket, CHECK-enforced `expires_at`). `hotlink` (never persist; storage_key NULL, remote_url set - **now visible to the read-model and search**, see §4) and long-lived `cache` are opt-in. KR watermark is **never** removed. JA/KR official hosts may run `hotlink` for the lowest re-hosting footprint, but note this disables bleed/upscale for those rows and is fragile against UA/Cloudflare blocks; an operator wanting native ~350 in MPC exports should set those sources to `ephemeral`/`cache`.

---

## 7. Search / browse / print-list UX

**Engine: Meilisearch** (one index per language, `cards_en … cards_zh-tw`), federated `POST /multi-search`. `name_en` searchable in every index so "Charizard" finds the JA card. Per-index `localizedAttributes` forces the right CJK tokenizer (`jpn`/`cmn`/`kor`). **Fallback:** Postgres FTS (`tsvector` GIN, Latin) + **`pg_bigm`** GIN (CJK bigram, real recall - not trigram-only) behind the shared `SearchProvider`, selected by `SEARCH_BACKEND`, honestly documented as degraded vs Meilisearch.

**Facets (left rail):** Set (typeahead via facetSearch - 209 EN sets), Language, Supertype, Type/Subtype, Rarity, Regulation mark (chips F/G/H), Promo, Jumbo, and **"Only cards with a scan in this language"** (`has_localized_image`, now materialized in `card_display`). Facet counts from `facetDistribution`.

**Frontend (Next.js App Router, `[locale]` segment, next-intl x10):**
- **Browse grid:** virtualized (`@tanstack/react-virtual`), lazy WebP via `next/image` (grid-res thumbnails only - never print-res, for bandwidth and hosting-exposure), each tile overlaid with a `DpiBadge` (~350/~296/~242) and a `FallbackBadge` "EN" pill when no localized scan.
- **Card detail:** the **LanguageSwitcher** is the centerpiece - all 10 langs (solid if a localized scan exists, "EN image" tagged if not); selecting a lang updates text + image and renders the honest fallback banner + DPI label of the image actually shown. Single read returns all localizations.
- **Jumbo policy (completeness fix):** oversized/jumbo cards (`is_jumbo`) are **searchable and viewable** but **print-disabled** - the "Add to print list" action is blocked with a tooltip ("Oversized card - not printable at the fixed 63x88 mm size"). They are never silently force-fit to 63x88. (An operator may opt into "print scaled to 63x88 with a 'scaled from oversized' badge" via a config flag; default is print-disabled.)
- **Print list (cart):** persistent in `localStorage` (Zustand persist, versioned key `ptcg.printlist.v1`) with optional debounced server sync for logged-in users + login-merge. Line identity = `(printId, lang, art_variant, face)`; identical keys merge and bump quantity; default `face='front'`. (**`art_variant`** is `native|upscaled|fallback-en` - renamed from "variant" to disambiguate from imgproxy **presets**.)
- **Search state lives in the URL** (shareable, SSR, back-button correct); the print list lives in localStorage.

**Read APIs:** `GET /api/v1/search`, `/facets`, `/facets/search`, `/cards/{printId}`; print-list CRUD; render-job submit/poll (§8). Cacheable (`s-maxage=300, stale-while-revalidate=86400`). Reindex is event-driven ("lang X dirty" → re-push only `cards_<lang>`).

---

## 8. Print engine (exact geometry + both export modes)

### 8.1 The invariant
SIZE fixed at **63x88 mm = 2.4803x3.4646 in** (`standard`, not `japanese` 59x86). DPI orthogonal, applied only at `px = round(mm/25.4*DPI)`. reportlab/pdf-lib draw marks as **vector** (crisp at any printer DPI); card images are raster placed at exact mm rects.

### 8.2 Canonical pixel dimensions (verified, formula-consistent)

| Box | @300 DPI | @600 DPI |
|---|---|---|
| Trim (63x88) | **744 x 1039 px** | **1488 x 2079 px** |
| Bleed - MPC target (822x1122) | **822 x 1122 px** | 1644 x 2244 px |
| Bleed - geometric 1/8 in (3.175 mm uniform) | ~819 x 1114 px | ~1638 x 2229 px |
| Corner radius (3 mm) | ~35.4 px | ~70.9 px |
| Safe zone inset | 3.175 mm (1/8 in) inside trim | - |

**Two bleed constants kept distinct in code** (avoids the ~0.15 mm drift bug):
- **Mode A home-cut** uses the **geometric 1/8 in = 3.175 mm uniform** bleed.
- **Mode B MPC** targets MPC's exact **822x1122** pixel spec. Quantified honestly: 822x1122 @300 = trim + **3.30 mm L/R** + **3.51 mm T/B** - an **asymmetric** bleed (H ≠ V by ~0.2 mm), by MPC's spec, **NOT** the 3.175 mm geometric bleed and **not** "1/8 in." The sharp compositor centers the 744x1039 trim inside 822x1122 (the asymmetric remainder spills symmetrically per axis); the two bleed constants are **never mixed on one output canvas**. Trim aspect 744:1039 (0.7161) ≈ 63:88 (0.7159) within rounding.

### 8.3 9-up page geometry (work in mm, convert to points `pt = mm/25.4*72`)
3x3 grid of 63x88 cells = **189 x 264 mm** trim block.

| Page | Size (mm) | Slack (mm) | Centered origin x0,y0 (mm) |
|---|---|---|---|
| **A4** (required for full bleed) | 210 x 297 | 21 x 33 | 10.5, 16.5 |
| **US Letter** | 215.9 x 279.4 | 26.9 x 15.4 | 13.45, 7.70 |

Cell top-left: `cell_x(c)=x0+c*63`, `cell_y(r)=y0+r*88` (reportlab bottom-left origin: `y_pdf = page_height_mm - cell_y - 88`).

**Letter + bleed: honest correction.** The gutter-sharing trick is correct for INTERIOR seams but **does not rescue the OUTER edges**. With synthesized bleed the real inked footprint is **189 x 270.35 mm** (264 + 2×3.175), **not** 189x264. On Letter the top row's outer bleed starts at `7.70 − 3.175 = 4.53 mm` from the page edge and the bottom row's outer bleed reaches `4.52 mm` from the bottom edge - **both ~1.8 mm INSIDE the 6.35 mm (0.25 in) printer unprintable margin.** So with bleed enabled on Letter the outer ~1.8 mm of the top/bottom bleed is **clipped by the printer** (acceptable as bleed beyond the cut line), but the cut/registration marks for the outer rows may also be clipped. The earlier "1.35 mm headroom / footprint stays at 189x264 / Letter just fits" claim was computed against the trim block and ignored the bleed - it is corrected here.

**Policy:**
- **A4 is required for full bleed** (top bleed edge at 13.32 mm, 6.97 mm clear of the margin - genuinely fine).
- **Letter with bleed:** supported but warned; the renderer drops to an **8-up safe layout** on Letter when `with_bleed=true` is incompatible with the printer margin, OR keeps 9-up and clips outer bleed with an explicit warning. Default behavior: warn and recommend A4; offer the reduced Letter layout as a one-click option.
- **Letter without bleed** (the schema default `with_bleed=false`) is fine at 9-up. The A4-default + bleed-default-false combination means the geometry warning fires only when a user enables bleed on Letter.

### 8.4 Source normalization (shared)
Decode → RGBA; resize card body to trim box (Lanczos); synthesize bleed (no source ships it) by **edge-extend** (default, replicate outer ring) or **mirror** (textured borders); flatten transparent rounded corners onto a sampled border-color matte first (PNG sources) so bleed doesn't extend transparency; opaque JA/KR JPEGs handled directly. Grayscale only for Mode A ink-saver. `fit:'fill'` to trim is safe (distortion < 0.2%), but an aspect-tolerance guard rejects oddly-cropped sources before fill; **jumbo cards are blocked at the add-to-list step (§7), not at render**, so the guard is a backstop not the primary control.

### 8.5 Mode A - home-print PDF (vector)
3x3 N-up (or 8-up Letter+bleed), A4 + Letter, 300/600 DPI, grayscale ink-saver, **vector** crop marks (3 mm ticks in gutter) + faint interior grid + **registration marks** (`none|3-corner|4-corner`, silhouette-card-maker spec in the unprintable band). Double-sided: backs page mirrors fronts (long-edge → mirror X `c→2-c`; short-edge → mirror Y `r→2-r`). **Card back = generic "PROXY - NOT FOR SALE" art only; the official Pokemon back is hard-blocked** (§10). Per-job calibration `{offset_x_mm, offset_y_mm, scale_x, scale_y, back_offset_*}` + a `--calibration-sheet` mode; persist per-user profiles. Footer text embeds OFL Noto fonts (CJK+KR) for the 10-language disclaimer.

### 8.6 Mode B - MPC-ready ZIP
Per-card **822x1122** PNG (1644x2244 @600) with synthesized **asymmetric** bleed (3.30 mm L/R, 3.51 mm T/B per §8.2) + transparent rounded corners when the source had alpha (MPC dies the radius; opaque sources ship full-rect). Naming `fronts/{slot:03d}_{set}_{number}_{lang}.png`; shared `backs/proxy_back.png`. The **mpc-autofill `order.xml` is clean-room reimplemented** (a file format is not copyrightable) in an isolated module with our own license - **zero lines copied from GPL-3 chilli-axe/mpc-autofill** (CI import-check enforces). `bracket` = smallest tier ≥ quantity from the ladder **verified against the current MPC "Game Cards 63x88mm" product**: `{18,36,55,72,90,108,126,144,162,180,198,216,234,396,504,612}` - **this ladder is a known footgun: it overshoots a 240-card order to 396**. The exporter (a) emits the bracket from whatever ladder is configured and (b) carries a `// VERIFY against live MPC product before launch` note plus a config-overridable ladder, because MPC periodically adds tiers (e.g. 252/288/360). The smallest-bracket rule is correct; the ladder values are the maintenance risk (tracked in §12). `id` uses `local:` relative paths into the ZIP. Package with streaming zip to SeaweedFS; include a README with the non-commercial/proxy disclaimer (OFL fonts).

### 8.7 Async render pipeline
`POST /api/v1/render-jobs {target:pdf|mpc, lines[], options{paper,dpi,cropMarks,registrationMarks,inkSaver,doubleSided,back:generic|none}}` → 202 `{jobId, pollHref}` → pg-boss/BullMQ → worker → SeaweedFS `artifacts/{job_id}/…` → **short-TTL (24h) presigned URL**; artifacts auto-deleted after 7 days. Poll at 1.5 s with backoff. The `back` enum is `generic|none` only. Prepared cards cached by `(image_hash,dpi,mode,bleed_mode,grayscale,upscale)`.

### 8.8 Worked geometry example (end-to-end regression fixture)
One card, A4, 300 DPI, with MPC bleed:
- trim mm = 63 x 88 → trim px = `round(63/25.4*300)` x `round(88/25.4*300)` = **744 x 1039**.
- MPC bleed px = **822 x 1122**; trim centered inside → L/R remainder `(822-744)/2 = 39 px = 3.30 mm`, T/B remainder `(1122-1039)/2 = 41.5 px ≈ 3.51 mm`.
- page placement (cell r=1,c=1, the center cell): `cell_x = 10.5 + 1*63 = 73.5 mm`; `cell_y = 16.5 + 1*88 = 104.5 mm`; reportlab `y_pdf = 297 - 104.5 - 88 = 104.5 mm`; in points `x_pt = 73.5/25.4*72 = 208.35 pt`, `y_pt = 104.5/25.4*72 = 296.22 pt`. Implementers should unit-test these exact values.

---

## 9. Infrastructure & deployment (the $0 path + docker-compose service list)

**One host, one docker-compose.** Profiles run a lean core or the full set.

**docker-compose services:** `caddy` (only public 80/443, auto-TLS, routes `/`→web, `/api`→api, `/img`→imgproxy) · `web` (Next.js standalone) · `api` (Fastify + pg-boss/BullMQ producer) · `worker` (BullMQ: sharp bleed/N-up + pdf-lib/reportlab + MPC ZIP + scrape jobs) · `upscaler` (Real-ESRGAN-ncnn-vulkan, CPU-capped `cpus:2.0`, queue concurrency 1-2) · `postgres` (16-alpine) · **`valkey`** (valkey:8-alpine, BSD - **service renamed from `redis`** so the name matches the engine and the license posture; BullMQ/pg-boss connect to host `valkey`) · `meili` (meilisearch:v1.10) · **`seaweedfs`** (S3 gateway; **replaces minio** - managed via CLI/IaC, no admin-console dependency) · `imgproxy` · optional profiles `uptime-kuma`/`dozzle`/`glitchtip` and a cron one-shot `backup`. Secrets via Docker secrets (`/run/secrets/*`), `.env` gitignored with a committed `.env.example`. **(The prior "MinIO console behind basic-auth" line is removed - that console no longer exists in the free build.)**

**Resource budget on a 24 GB ARM box:** postgres ~512 MB, valkey 256 MB, meili ~300 MB, seaweedfs ~256 MB idle, imgproxy ~128 MB, web ~300 MB, api ~300 MB, worker ~1 GB peak, upscaler ~2 GB peak → comfortably < 8 GB steady; also fits a 4 GB box if the upscaler is profile-gated.

### The truly-$0 host - and the honest asterisks
- **Primary: Oracle Cloud Always-Free ARM (Ampere A1)** - up to 4 OCPU / 24 GB / 200 GB block / **10 TB egress/mo, no expiry**. Runs the whole compose file (all images have arm64 builds; Real-ESRGAN runs CPU-only on ARM). **Asterisks:** (1) capacity-gated ("out of host capacity" - needs launch-retry or a quieter region); (2) idle-reclaim if 95th-percentile CPU < 20% over 7 days (real traffic or a tiny keep-busy cron clears it); (3) single box = SPOF → mitigate with disciplined tested backups, not a paid cluster.
- **Fully sovereign alternative: home server** (mini-PC / Pi 5 8 GB) via free **Cloudflare Tunnel** (hides home IP, no port-forward) - best fit for the "removable hosting / fast DMCA kill switch" posture.
- **NOT $0:** Fly.io removed its free tier in 2024; Render/Railway/Heroku free tiers sleep/expired. Honest cheap fallback if Oracle is blocked and you have no home box = **~$5/mo VPS** (Hetzner CX22 etc.) - the *software* is free, the *VPS is not*.

### CI/CD: public-vs-private resolved (review conflict)
The legal "low profile" stance is about the **deployed site**, not the source. **Decision: keep the source repo PUBLIC** - the code is FOSS anyway, so CI is fully $0 (unlimited Actions minutes + free public GHCR images), and low-profile is enforced at the site (noindex, robots Disallow, isolated image host). **If an operator insists on a private repo**, the scheduled `weekly TCGdex delta ingest + Meili reindex + restore-check` jobs move to the **host's own cron** (alongside the `backup` one-shot) and arm64 images build **natively on the Oracle ARM box** (not emulated buildx), to stay under the 2000 free private minutes/mo + 500 MB GHCR storage. Pick one explicitly; the shipped default is public-repo CI.

### Egress shield, backups
- **R2 behind Cloudflare CDN** caches hot images at zero egress; **edge-cache so most reads never count as R2 Class B ops** (`Cache-Control: immutable` on signed image URLs). R2 is cache only, never source of truth.
- **Backups:** nightly `pg_dump -Fc | restic` to a **2nd disk (primary $0 path)** and optionally B2 off-site; `restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune`; quarterly tested restores. **Honesty:** B2 free = 10 GB storage + ~1 GB/day free egress + transaction caps, so a full quarterly restore drill from B2 may briefly incur ~$0.01/GB egress - prefer the 2nd-disk restore for the truly-$0 path, B2 as off-site copy. Only the Postgres DB is precious - metadata is re-ingestable from the MIT TCGdex dump and images are re-renderable.

### Hard $0 limits, stated plainly
- Oracle (capacity + idle-reclaim).
- **R2 free = 10 GB storage + zero egress + 1M Class A ops/mo + 10M Class B ops/mo**; over = $0.015/GB-mo storage, $4.50/M Class A, $0.36/M Class B. Edge-cache in front to keep reads off R2.
- **B2 free = 10 GB storage + ~1 GB/day free egress + transaction caps**; restore drills may incur ~$0.01/GB egress; storage over = $6/TB-mo.
- **pokemontcg.io = DEPRECATED (merged into paid Scrydex); treat as may-vanish; `OVERLAY_ADAPTER=none` is the $0 default** so it is not a hard dependency.
- GitHub Actions = unlimited on **public** repo; 2000 min-mo + 500 MB GHCR on private (move schedules to host cron if private).
None bite at launch scale on the chosen defaults.

---

## 10. Legal / compliance checklist (informational - not legal advice; attorney sign-off is a hard launch gate)

High-enforcement IP zone (Pokellector was sued for **both** trademark *and* copyright; the MIT data license covers metadata only, **not** the art). One committed `compliance.config.ts` is the single source of truth; a CI spec test fails the build if prod defaults drift.

1. **Generate-don't-host (default `serving_mode='ephemeral'`).** Isolated bucket, hard 7-day TTL + auto-purge, **CHECK-enforced** `expires_at`. `cache`/`generate` are opt-in self-host modes. Ephemeral shrinks the persistence surface (Pokellector's copyright exposure came from *hosting*).
2. **Never reproduce the official card back.** Default fronts-only (`back.mode='none'`); optional back is our own "PROXY - NOT FOR SALE" art. Official back hard-blocked via `blocked_asset` matching **both** `url_pattern` and `sha256`, returning **HTTP 451**. Reproducing it crosses proxy → counterfeit.
3. **Strictly non-commercial - donations only on non-IP value.** Ko-fi + GitHub Sponsors + Liberapay as static footer links; no payment code/PII on our servers; donations unlock nothing functional.
4. **No Pokemon trademark in branding/domain/logo/favicon/handles.** CI brand-lint greps branding slots. Nominative descriptive use of "Pokemon Trading Card Game" allowed only in body copy.
5. **Pricing OFF by default.** TCGplayer terms forbid commercial/competitive redistribution; pokemontcg.io's bundled prices are migrating to paid Scrydex. If enabled, the price component **fails closed** unless the exact required attribution string is present (`card_price.attribution NOT NULL`).
6. **GPL-3 isolation.** mpc-autofill is GPL-3.0; our `order.xml` serializer is a clean-room reimplementation in an isolated module with its own license + a CI import-check failing on any reference to mpc-autofill. silhouette-card-maker (MIT) may be vendored/credited.
7. **License hygiene of our own stack:** object store is **Apache-2.0 (SeaweedFS)** - no AGPL network-service question. Embedded PDF/ZIP fonts are **OFL Noto Sans / Noto Sans CJK** (embedding-permitted across all 10 langs). Both reduce license exposure vs the prior MinIO/AGPL choice.
8. **Low profile by default.** `seo.noindex=true`, `robots.txt Disallow: /`, `X-Robots-Tag` on app and image host (`img.<host>`). Self-hosters can opt into discoverability. (Risk-reduction, not a legal defense.)
9. **DMCA readiness.** Designated agent registered (~$6 one-time US filing); image host isolated on its own non-listable bucket + CDN host; `takedown(caseRef, target)` is one transactional admin action: insert `blocked_asset` + purge ephemeral cache + suppress rows (`card_print.is_suppressed`) + bust CDN + write `takedown_log` + update `dmca_request`.
10. **Label honestly.** `is_english_fallback` (derived) / `is_upscaled` / `is_watermarked` surfaced in UI and baked into PDF metadata + ZIP README; "proxies are NOT tournament-legal."
11. **Attorney review pre-launch is a hard gate, not optional.**

### Suggested footer disclaimer (i18n'd across all 10 launch languages; baked into PDF footer + ZIP README, rendered with OFL Noto CJK/KR fonts)
> *This is a free, non-commercial, fan-made tool. It is not affiliated with, endorsed by, or sponsored by Nintendo, The Pokemon Company, Game Freak, or Creatures Inc. Pokemon and all related names, characters, and card designs are trademarks and copyrights of their respective owners, used here for identification and reference only. Cards generated by this tool are unofficial proxies for personal playtesting and casual use; they are NOT tournament-legal and may NOT be sold, traded, or used to deceive. We do not sell or ship cards. Donations support only the operation and development of this free tool and do not purchase any Pokemon content or rights.*

### Suggested usage-terms wording (excerpt for `/terms`, consent-gated before render)
> *By generating a proxy you confirm: (1) it is for personal, non-commercial playtesting/casual use only; (2) you will not sell, distribute for profit, or present proxies as genuine cards; (3) you understand proxies are not tournament-legal; (4) you are responsible for your own use under the laws of your jurisdiction. Rights holders may request removal of any specific card via our DMCA contact; such content will be blocked and purged promptly.*

---

## 11. Phased build roadmap

- **Phase 0 - Foundations (1-2 wk).** Repo + monorepo layout, `docker-compose.yml`, Postgres migrations (the full `sqlSchema`), **CI migration smoke-test that applies `sqlSchema` verbatim to a clean `postgres:16-alpine` and fails on any error** (would have caught the generated-column blocker), SeaweedFS + Valkey + Caddy up, `.env.example` + Docker secrets, CI (lint/type/test/buildx → GHCR), `compliance.config.ts` + CI spec test + brand-lint + GPL-import-check.
- **Phase 1 - Data spine (1-2 wk).** Self-host TCGdex Docker clone; `SourceAdapter` + DTOs; ID normalization (incl. `collector_number_norm` trigger) + set-matcher + `set_mapping` + `card_print_review` queue; backfill ingest (EN first via TCGdex/malie, overlay default OFF) with idempotent `source_etag` upserts; nightly incremental cron.
- **Phase 2 - Image pipeline (2 wk).** Resolver + per-language priority table; fetch-once into SeaweedFS (rate-limit, browser UA, negative cache); JA detail-page scraper + filename cache; English-image-fallback via read-model; imgproxy serve plane with the `print_id → storage_key/remote_url` lookup + WebP warm-cache. (Defer KR-stored source pending legal review; EN fallback covers it.)
- **Phase 3 - Search + browse (1-2 wk).** Meilisearch per-lang indexes + federated multi-search + facets (incl. `has_localized_image`); Postgres-FTS + pg_bigm fallback behind `SearchProvider`; Next.js grid (virtualized, lazy WebP, DPI/fallback badges) + card detail + LanguageSwitcher; jumbo print-disable; URL-state search.
- **Phase 4 - Print list + engine (2 wk).** localStorage cart (line identity `(printId,lang,art_variant,face)`); render-job API + pg-boss/BullMQ worker; Mode A home PDF (geometry with 744x1039/1488x2079, vector marks, A4/Letter, 8-up Letter+bleed fallback, 300/600, ink-saver, duplex, calibration, OFL fonts); Mode B MPC ZIP (822x1122 asymmetric bleed + clean-room order.xml + verified bracket ladder); generic proxy back; signed-URL download + 7-day TTL.
- **Phase 5 - Compliance hardening (1 wk).** `blocked_asset`/451 enforcement; ephemeral TTL CHECK + auto-purge; `takedown()` admin action; noindex/robots; i18n disclaimer/terms/DMCA x10; donation footer.
- **Phase 6 - Optional upscale + observability + backups (1 wk).** Real-ESRGAN async queue (x4-then-resize, gated, labeled); Uptime Kuma/Dozzle/GlitchTip profiles; restic backups (2nd disk primary, B2 off-site) + tested restore in CI.
- **Phase 7 - Pre-launch gate.** Attorney review (hard gate); per-language name-recall fixture tests; **geometry regression test against the §8.8 worked example**; MPC bracket-ladder re-verification against the live MPC product; restore drill; R2/CDN egress shield; malie.io availability/terms check; promo-tail curation kickoff.

---

## 12. Open items

- **Attorney sign-off (hard launch gate).** Especially: ephemeral-cache-as-temporary-hosting risk (attorney may direct `storage_mode='generate'`), donation copy, KR-watermarked-art hosting, nominative-use wording.
- **malie.io is now load-bearing for the $0 EN-hires path** (since pokemontcg.io merged into paid Scrydex). Its availability and terms are **unverified** - a Phase-7 check must confirm it; if it disappears, the EN-hires tier degrades to TCGdex `high.png` (~242) until a `ScrydexAdapter` or new source lands.
- **pokemontcg.io → Scrydex.** Deprecated default-OFF mitigates today, but a future free overlay or paid Scrydex decision is still open.
- **KR / zh-cn image scarcity.** Heavy permanent reliance on EN fallback; UX is correct but sparse. Decide whether to enable the watermarked KR source (legal review) or accept EN-only art.
- **JA scraper fragility.** pokemon-card.com HTML restructure / UA-IP blocks would drop the only native >300 DPI source to the 600x825 tier; circuit breaker + filename cache + EN fallback reduce but don't eliminate.
- **`card_display` materialized view scale.** ~23k EN cards x 10 langs ≈ 230k rows; `REFRESH CONCURRENTLY` cost grows with the catalog - may need per-language partial MVs or on-demand caching, and decide its exact role vs Meilisearch as catalog grows.
- **MPC bracket ladder maintenance.** The shipped ladder overshoots some orders (240 → 396) and MPC periodically adds tiers (252/288/360). The smallest-bracket-≥-quantity rule is correct; the **ladder values are a maintenance dependency** - config-overridable + a Phase-7 re-verification against the live product. Not schema-enforceable.
- **Letter + bleed layout.** Default A4 + the 8-up Letter+bleed fallback resolve the printer-margin clipping, but per-printer unprintable margins vary; consider a per-printer calibration onboarding flow.
- **Rarity normalization curation.** `rarity_norm` lookup needs ongoing curation. **Declined hard FK** `card_print.rarity → rarity_norm`: a strict FK would reject ingest of any card whose rarity hasn't been mapped yet, blocking the "every card ever printed" requirement. Instead the schema keeps `rarity` free-text plus a `rarity_norm_id` nullable FK and a CHECK-free path, and unmapped rarities surface in a coverage report (below) for curation rather than failing ingest.
- **Per-language/per-set coverage dashboard (missing piece, accepted).** Add an admin coverage view (cards-with-localized-image vs without, per language; unmapped-rarity count; `needs_review` count) so "every card + tiered gap-fill" is verifiable, not aspirational. Deferred to post-launch ops; not on the launch critical path.
- **Promo natural-key mismatches** now route to the schema-backed `card_print_review` queue, but an **admin UI and an owner** for that queue are still a process dependency.
- **Energy cards / sealed-only / box-toppers.** `is_sealed_only`/`is_jumbo` flag them; basic-energy in-scope decision and box-topper printability beyond the jumbo print-disable rule are deferred.
- **Hotlink high-res in MPC export.** A Western-only print with no hires EN source can only export at ~242; JA/KR ~350 hotlink rows are now searchable but, in `hotlink` mode, can't be composited into bleed for MPC. Operators wanting native ~350 in MPC must set those sources to `ephemeral`/`cache` (documented in §6.6); the DPI-vs-target mismatch is surfaced as a render-time honest warning rather than a silent upscale.
- **Search relevance across languages.** Federated multi-search mixes per-index score scales; group results by language in the UI for multi-lang queries.
- **localStorage cart limits.** ~5 MB cap and loss on clearing site data for anon users; cap list size with a warning and encourage login.
- **Donation honesty.** Keep donations strictly non-functional and trademark-free (Pokellector precedent).

### Intentionally declined fixes (with reasons)
- **Hard FK `card_print.rarity → rarity_norm` + CHECK on `regulation_mark`:** declined as written. A strict FK/enum would fail ingest on any not-yet-mapped rarity or a future regulation mark, directly conflicting with the "ingest every card ever printed" mandate (new rarities/marks ship in new languages before we curate them). Compromise applied: nullable `rarity_norm_id` FK (catches mapped values, allows unmapped), a lightweight `regulation_mark` format CHECK (`~ '^[A-Z]$'` - permissive, not an enum), and a coverage report to drive curation. This keeps unmapped values visible without making them ingest-blocking.
- **Single-store UNIQUE on `image_variant.checksum_sha256`:** declined as a row-level UNIQUE. Dedup is done at the **object layer** (content-addressed in SeaweedFS, byte-identical stored once); a row-level UNIQUE across `(card_print_id, lang, checksum)` would forbid legitimately recording that the same bytes came from two provenance sources (audit value). The §5/§6 wording is softened to "content-addressed in storage (object dedup), not row dedup."
- **Dropping `face='both'` entirely vs defining its semantics:** kept `face IN ('front','back','both')` but **documented `'both'` = 1 front + 1 back per `quantity`** and excluded it from the front-count math by treating duplex primarily as the `print_list.duplex` job option; `'both'` remains for the rare per-line override. (Removing it outright would lose a real user case; defining semantics resolves the merge-math ambiguity the review raised.)

CURRENT TECH STACK note: pokemontcg.io appears only as a deprecated, default-OFF overlay; the shipped EN path is TCGdex + malie.io.