# Proxy Printer

A **free, open-source, self-hostable** website for finding any **Pokémon TCG**
card in every major language and printing **playtest proxies** at the fixed
competitive card size (63x88 mm). Non-commercial; donations only.

> Naming: the public project name is **Proxy Printer** and every shipping
> identity slot (npm scope `@proxyforge/*`, the docker-compose project) is kept
> deliberately trademark-free - enforced by `scripts/brand-lint.mjs` per
> `docs/ARCHITECTURE.md` sec.10. The GitHub repo is named descriptively
> (`pokemon-proxy-card-printer`); "Pokémon" appears here and elsewhere only as
> descriptive/nominative use, never in a brand slot.

> Status: **Phases 0-4 done, plus the Meilisearch search backend.** Foundations
> and the TCGdex data spine (Phase 1), the image pipeline (Phase 2: best
> per-language sourcing + fetch-into-storage with honest measured DPI), the
> browse/detail/print web UI (Phase 3), the dual-mode print engine (Phase 4:
> home PDF + MakePlayingCards ZIP), and per-language Meilisearch indexes
> (typo-tolerant, multilingual) with an automatic Postgres-FTS fallback. See
> `docs/ARCHITECTURE.md` for the full design and the
> [Roadmap](#roadmap--what-still-needs-doing) below for what is left.

> Legal: this is a fan tool for personal, non-commercial playtesting. Proxies are
> **not** tournament-legal and may not be sold or passed off as genuine. Card
> art and text are copyright their respective owners; this project is not
> affiliated with, endorsed by, or sponsored by any rights holder. See
> `docs/ARCHITECTURE.md` sec.10. An attorney review is a hard gate before any
> public launch.

## Size vs DPI (the important distinction)

- **SIZE is fixed: always 63x88 mm** (the universal competitive size). Hardcoded.
- **DPI is separate** - it is image sharpness, the only quality dial. `744x1039 px`
  @300 DPI, `1488x2079 px` @600 DPI for the same physical rectangle.

## Stack (all FOSS, $0 to run)

TCGdex (data spine) -> PostgreSQL 16 + pg_bigm -> SeaweedFS (storage) +
Meilisearch (search) + Valkey (queue) + imgproxy/sharp -> Next.js + Fastify,
behind Caddy. One `docker compose` on an Oracle Always-Free ARM box or a home
server. pokemontcg.io is a deprecated, default-OFF overlay (merged into paid
Scrydex), kept behind a swappable adapter.

## Quickstart

Prereqs: **Node >=22** and **Docker**. (Only Node is needed for unit tests.)

```bash
cp .env.example .env          # then edit secrets in .env (gitignored)
npm install

# offline checks (no DB, no network)
npm run typecheck
npm test                      # unit + in-process-Postgres (PGlite) integration tests; see docs/TESTING.md
npm run brand-lint && npm run gpl-check

# bring up Postgres + Meilisearch (builds the pg_bigm image the first time)
docker compose up -d postgres meilisearch
npm run migrate               # applies db/schema.sql

# ingest the TCGdex spine. Start with a tiny dev slice:
npm run ingest -- backfill --langs en,ja,fr --limit-sets 2
# ...then the full multilingual backfill:
#   point TCGDEX_BASE_URL at a self-hosted tcgdex clone first, then:
npm run ingest -- backfill --refresh-mv        # add --full for rich per-card data

# build the search index, then start the UI:
npm run search -- reindex
npm run web:dev               # http://localhost:3000
```

### Image pipeline (Phase 2)

Fetches the best per-language source into storage with real measured DPI. EN
upgrades to ~296 via the pokemontcg.io image CDN; other languages use TCGdex
(~242); honest DPI is recorded per image. Default storage is local FS
(`data/images`, $0); set `STORAGE_BACKEND=s3` + `IMAGES_DIR` for production.

```bash
npm run images -- fetch --langs en,fr,de,it,es,pt,ja,ko,zh-cn,zh-tw
npm run images -- fetch --langs en --limit 50      # dev slice
npm run images -- fetch --no-en-hires              # TCGdex-only
```

### Search (Meilisearch + Postgres fallback)

The `card_display` materialized view is the read-model; `npm run search -- reindex`
refreshes it and routes every row into a **per-language Meilisearch index**
(`cards_en … cards_zh-tw`), each with its own CJK-aware `localizedAttributes`.
With `SEARCH_BACKEND=meili` (the default) the web app gets typo-tolerant,
multilingual ranking; if Meili is unreachable or the indexes are not built yet it
transparently falls back to the Postgres FTS + `pg_bigm` query, so the site never
hard-fails.

```bash
npm run search -- reindex                       # refresh MV + (re)index all docs
npm run search -- reindex --langs en,ja         # subset of languages
npm run search -- status                        # index health + document count
npm run search -- search "charizard" --lang en  # debug a query from the CLI
```

Re-run `reindex` after each ingest so the indexes track the catalog.

### Web UI (Phase 3)

```bash
export IMAGES_DIR="$PWD/data/images"   # share the image store with the renderer
npm run web:dev                        # http://localhost:3000
# or: npm run web:build && npm -w @proxyforge/web run start
```

Faceted browse (set / language / type / promo + name search, sortable by newest/oldest/set, with a 24/48/96 per-page control, a one-click Clear when any filter is active, a "showing X-Y of N" range label, a jump-to-page box on the pager, and a context-aware empty state that suggests which filters to loosen), card detail with a
language switcher, DPI / English-fallback badges, a quantity selector when
adding to the list (add 4 copies in one click) and a "copy decklist line"
button (`1 <name> <SETCODE> <number>`, pasteable into a decklist and
round-trippable through Import), a localStorage print list (with a display sort
by added order / name / quantity and per-row -/+ quantity steppers),
and a one-click render to home PDF or MakePlayingCards ZIP (with paper, DPI,
gutter, and bleed options, plus an optional deck name that slugifies into the
download filename, e.g. `my-lugia-deck.pdf`). The render options (target,
paper, DPI, gutter, bleed, deck name, plus the print-list display sort and the
export format) persist in localStorage and are restored on the next visit, with
each stored field validated/clamped on load so a stale entry can never put the
form into an invalid state. Search is served by
Meilisearch with the Postgres fallback described above.

**Decklist import.** Paste a Pokémon TCG Live / Limitless decklist
(`<qty> <name> [<setCode> <number>]`, e.g. `4 Pikachu SVI 94`; Trainer/Energy
lines can be name-only) on the print page and the whole list is resolved into
the print list in one step - set code + number via `card_set.ptcg_code`, with a
name fallback. Unmatched lines (e.g. PTCGL promo renumbering) are listed for
manual fixup, and when a card is named on more than one line the import reports
how many lines were combined (and the summed quantity), so a split playset is
not mistaken for a missing one.

**Decklist export.** "Export this list" on the print page emits a decklist
(`<qty> <name>`) with copy-to-clipboard and download-as-`.txt` buttons (the file
is named from the deck name, e.g. `my-lugia-deck.txt`), in one of two formats:
Grouped into Pokémon / Trainer / Energy sections with counts (cards added by
browsing or by Import carry their supertype), or Plain (`<qty> <name>` lines
only, no headers) for tools that reject section headers. The print list header shows the total copies with a unique-card count when they
differ (e.g. `40 cards (14 unique)`) and a one-line breakdown by supertype
(e.g. `12 Pokémon · 34 Trainer · 14 Energy`) when the list spans more than one.
Save a list or move it between devices (the localStorage cart is per-browser);
it round-trips back through Import. The grouping/summary/export logic lives in a
pure, unit-tested `apps/web/lib/printlist.ts`.

### Printing (Phase 4)

```bash
# from a print_list in the DB (size is always 63x88mm; choose paper/dpi/bleed):
npm run print -- pdf --list <uuid> --out deck.pdf --paper A4 --dpi 300 --bleed
npm run print -- mpc --list <uuid> --out deck.zip --dpi 300

# standalone demo from image URLs (no DB needed):
npm run print -- pdf --urls "https://assets.tcgdex.net/en/sv/sv03/004/high.png" --out demo.pdf --bleed
```

- **Home PDF**: 3x3 N-up at fixed 63x88mm, optional 1/8in synthesized bleed,
  vector crop marks, A4/Letter, 300/600 DPI, ink-saver. Bleed requires A4 (nine
  full-bleed cards exceed US Letter height) - Letter+bleed auto-switches to A4.
- **MPC ZIP**: one 822x1122px (@300) PNG per card with asymmetric bleed + a
  clean-room `order.xml` (no GPL code) you feed to MakePlayingCards.

## Layout

```
db/                     canonical schema.sql (single source of truth) + pg_bigm Dockerfile + NOTES
docs/                   ARCHITECTURE.md, TECH_STACK.md, OPEN_ITEMS.md
docker-compose.yml      data-plane infra (postgres, valkey, meili, seaweedfs, imgproxy, caddy)
packages/config         typed env + the compliance posture (single source of truth)
packages/db             pg pool + migration runner (applies schema.sql)
packages/ingest         the Phase-1 spine: SourceAdapter, TCGdex adapter, normalization,
                        set-matcher, idempotent upserts, backfill + incremental, CLI
packages/images         the Phase-2 image pipeline: per-language source resolver,
                        fetch-into-storage (local FS / S3), honest DPI metadata, CLI
packages/search         the Meilisearch read-path + indexer: fetch-based Meili client,
                        card_display -> document mapping, keyset reindex, query builder, CLI
packages/print          the Phase-4 print engine: exact geometry (with gutter), sharp
                        image-prep + bleed synthesis, home PDF (pdf-lib), MPC ZIP, CLI
apps/web                the Phase-3 Next.js UI: faceted browse, card detail + language
                        switcher, localStorage print list, render API, image route
scripts/                brand-lint + gpl-import-check (CI gates)
.github/workflows/ci.yml  typecheck/test/lint + Postgres+pg_bigm migration smoke-test
```

## How multilingual data is modeled

Western languages (en, fr, de, it, es, pt) **share TCGdex set IDs**, so the same
physical card collapses into **one `card_print` row** with a `card_localization`
per language (natural key = `card_set_id` + normalized collector number).
Japanese, Korean, and Chinese use **different set structures**, so each becomes
its **own `card_print` row** (a genuinely distinct printing). English-image
fallback is derived in the read model when a localized scan is missing.

## Roadmap / what still needs doing

Done: Phase 0 (monorepo, config, db, CI), Phase 1 (TCGdex ingest), Phase 2 (image
pipeline, local-FS storage), Phase 3 (web UI), Phase 4 (print engine), and the
Meilisearch search backend with Postgres fallback.

Still open (roughly in priority order):

- [~] **Image coverage.** Only cards with an image source are browseable; the
      read-model excludes imageless cards. The malie.io source (below) is now
      wired manifest-driven and raises the five Western langs (en/fr/de/it/es) to
      296 DPI - but **only for the ~28 TCGL/SV+Mega-era sets malie carries**;
      older sets stay on TCGdex ~242, and JA native is blocked (below). Use
      `npm run images -- coverage` to measure the remaining gap.
- [ ] **JA native ~350 DPI scraper** (pokemon-card.com) - **BLOCKED on attorney
      sign-off (assessed 2026-06-11).** pokemon-card.com is the rights-holder's own
      site and its footer explicitly prohibits image reproduction
      ("無断転載はお断りします"), making this the project's highest legal exposure -
      do not build until explicitly cleared. Interim JA path stays TCGdex ~242
      (malie has no JA). If cleared: per-card scraping + circuit breaker +
      filename cache + EN fallback. See `docs/OPEN_ITEMS.md`.
- [x] **malie.io EN hi-res path - VERIFIED LIVE (2026-06-11).** Confirmed the $0
      replacement for the paywalled pokemontcg.io route: deterministic manifest
      (`cdn.malie.io/.../tcgl/export/index.json`) -> per-set image URLs, measured
      at exactly **296 DPI** (733x1024px), no per-card scraping. Covers all six
      Western langs (en/fr/de/it/es/pt) and **upgrades fr/de/it/es/pt from TCGdex
      ~242 to 296**. No formal license (rides the attorney gate).
      **DONE:** the `malie_io` ImageOrigin adapter is built and manifest-driven
      (set-gating + half-set/promo id mapping incl. 151 / Prismatic Evolutions);
      remaining is the live-DB set-id reconciliation for ~6 alt/energy sets (see
      `docs/OPEN_ITEMS.md`). No ja/ko/zh - the JA scraper is still the native-JA path.
- [ ] **Production serve plane** - SeaweedFS object storage + imgproxy
      derivatives (today images are local-FS only).
- [x] **Search refinement - per-language indexes DONE.** Replaced the single
      `cards` index + `lang` filter with one index per language (`cards_en …
      cards_zh-tw`) and per-index `localizedAttributes` (jpn/cmn/kor) for correct
      CJK tokenization; `nameEn` stays searchable in every index so an English
      query still finds the JA card. Contained to `@proxyforge/search` (the web
      `searchCards` API is unchanged). Needs a live-Meili smoke test. Remaining
      follow-up: federated `/multi-search` for cross-language results in one query
      (see `docs/OPEN_ITEMS.md`).
- [ ] **Optional Real-ESRGAN upscaling** (Phase 6) for low-DPI sources.
- [ ] **KR / Simplified-Chinese** image scarcity + watermarked-source legal review.
- [~] **Coverage report + admin UI.** The per-set / per-language image-coverage
      report is DONE (`npm run images -- coverage`: native / EN-fallback / hi-res /
      missing + cov%). Still open: a web admin UI for the `card_print_review` queue.
- [ ] **Attorney sign-off (HARD launch gate)** - ephemeral-cache-as-hosting risk,
      image redistribution terms, KR watermarked art, donation copy.
- [ ] **Public name + domain** - the project is now "Proxy Printer"; the npm
      scope (`@proxyforge/*`) and a domain are still to be finalized.

See `docs/OPEN_ITEMS.md` for the full decision log behind these.
