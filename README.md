# ProxyForge (placeholder codename)

A **free, open-source, self-hostable** website for finding any trading-card-game
card in every major language and printing **playtest proxies** at the fixed
competitive card size (63x88 mm). Non-commercial; donations only.

> Status: **Phase 0-4 done** - foundations, the TCGdex data spine (Phase 1), the
> image pipeline (Phase 2: best per-language sourcing + fetch-into-storage with
> honest measured DPI), the search/browse/print web UI (Phase 3), and the
> dual-mode print engine (Phase 4: home PDF + MakePlayingCards ZIP). Still open:
> production S3/SeaweedFS + imgproxy serve plane, the JA native-350 scraper, and
> Meilisearch (Phase 3 currently queries Postgres directly). See
> `docs/ARCHITECTURE.md` for the full design and `docs/OPEN_ITEMS.md` for decisions.

> Legal: this is a fan tool for personal, non-commercial playtesting. Proxies are
> **not** tournament-legal and may not be sold or passed off as genuine. Card
> art/text are copyright their respective owners. See `docs/ARCHITECTURE.md` sec.10.
> An attorney review is a hard gate before any public launch.

## Size vs DPI (the important distinction)

- **SIZE is fixed: always 63x88 mm** (the universal competitive size). Hardcoded.
- **DPI is separate** - it's image sharpness, the only quality dial. `744x1039 px`
  @300 DPI, `1488x2079 px` @600 DPI for the same physical rectangle.

## Stack (all FOSS, $0 to run)

TCGdex (data spine) -> PostgreSQL 16 + pg_bigm -> SeaweedFS (storage) +
Meilisearch (search) + Valkey (queue) + imgproxy/sharp -> Next.js + Fastify,
behind Caddy. One `docker compose` on an Oracle Always-Free ARM box or a home
server. pokemontcg.io is a deprecated, default-OFF overlay (merged into paid
Scrydex), kept behind a swappable adapter.

## Quickstart (Phase 0 + 1)

Prereqs: **Node >=22** and **Docker**. (Only Node is needed for unit tests.)

```bash
cp .env.example .env          # then edit secrets in .env (gitignored)
npm install

# offline checks (no DB, no network)
npm run typecheck
npm test                      # pure-logic unit tests
npm run brand-lint && npm run gpl-check

# bring up Postgres (builds the pg_bigm image the first time) and apply the schema
docker compose up -d postgres
npm run migrate               # applies db/schema.sql

# ingest the TCGdex spine. Start with a tiny dev slice:
npm run ingest -- backfill --langs en,ja,fr --limit-sets 2
# ...then the full multilingual backfill (rich per-card data):
#   point TCGDEX_BASE_URL at a self-hosted tcgdex clone first, then:
npm run ingest -- backfill --full --refresh-mv

# nightly delta (only new/changed sets):
npm run ingest -- incremental

# live adapter smoke test (hits the public TCGdex API):
npm run test:net
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

### Web UI (Phase 3)

```bash
export IMAGES_DIR="$PWD/data/images"   # share the image store with the renderer
npm run web:dev                        # http://localhost:3000
# or: npm run web:build && npm -w @proxyforge/web run start
```

Faceted browse (set / language / type / promo + name search), card detail with a
language switcher and DPI / English-fallback badges, a localStorage print list,
and a one-click render to home PDF or MakePlayingCards ZIP (with paper, DPI,
gutter, and bleed options). Phase 3 queries Postgres directly; Meilisearch is the
later drop-in.

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
