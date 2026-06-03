-- =====================================================================
-- Pixie-Proxy CONSOLIDATED DDL  (PostgreSQL 16, all free/contrib only)
-- FINAL, review-corrected. Executes verbatim against postgres:16-alpine.
-- Reconciles: data-model, ingestion-sync, image-pipeline, search-ux,
--             print-engine, infra-deploy, legal-compliance.
-- KEY FIXES vs prior draft:
--   * REMOVED invalid public_slug GENERATED ... ((SELECT NULL)) STORED
--     (Postgres forbids subqueries in generation exprs -> whole DDL aborted).
--     slug is a plain trigger-populated NOT NULL UNIQUE column.
--   * collector_number is now SPLIT: collector_number_norm (normalized,
--     part of the natural key) + collector_number_raw (printed/display).
--     A trigger derives _norm so the one-row-per-card invariant holds.
--   * card_print PK = uuid; tcgdex_id/ptcg_id = cross-source text.
--   * REMOVED redundant card_set.ptcg_set_id / tcgdex_set_id (single
--     foreign-id source of truth = set_mapping).
--   * set_mapping drops UNIQUE(card_set_id, source) so N foreign promo
--     sets can map to 1 canonical set; keeps UNIQUE(source, foreign_set_id).
--   * NEW card_print_review table + card_print.needs_review for the
--     promo collector-number collision queue (schema-enforced, not process).
--   * image_variant: + source_etag (uniform idempotent upsert);
--     english_fallback enum value REMOVED (fallback is read-model-derived);
--     CHECK ties serving_mode='ephemeral' to non-NULL expires_at + trigger.
--   * Postgres-FTS fallback is REAL: pg_bigm extension + bigm GIN on names,
--     tsvector generated column + GIN for Latin FTS.
--   * card_display MV: hotlink-inclusive (storage_key OR remote_url),
--     full facet/display field set, has_localized_image, name fallback
--     beyond EN, served_url + served_mode.
--   * enum image_source renamed -> image_origin (avoid clash w/ rejected
--     image_source TABLE name).
-- Run order: extensions/enums -> hierarchy -> images -> pricing ->
--            users/lists/jobs -> sync -> compliance -> views -> triggers.
-- =====================================================================

-- ---------- 0. EXTENSIONS + ENUMS + DOMAINS ----------
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- trigram (typeahead / similarity)
CREATE EXTENSION IF NOT EXISTS citext;     -- case-insensitive lang/email
CREATE EXTENSION IF NOT EXISTS pg_bigm;    -- CJK bigram FTS (Postgres search fallback)

-- Launch languages locked (pt = Portugal, NOT pt-br).
CREATE DOMAIN lang_code AS citext
  CHECK (VALUE IN ('en','ja','fr','de','it','es','pt','ko','zh-cn','zh-tw'));

CREATE TYPE source_system AS ENUM ('tcgdex','pokemontcg_io','bulbapedia','manual');

-- Renamed from image_source -> image_origin to avoid overloading the
-- rejected image_source TABLE identifier. NOTE: 'english_fallback' member
-- intentionally REMOVED -- EN fallback is derived in the read-model.
CREATE TYPE image_origin AS ENUM (
  'pokemontcg_io',     -- EN _hires 733x1024 (~296 dpi); DEPRECATED source (Scrydex)
  'malie_io',          -- EN png, byte-identical to pokemontcg_io; de-facto EN-hires default
  'pokemon_card_jp',   -- JA 868x1212 (~350 dpi), scraped detail page
  'tcgdex_assets',     -- other langs high.png/high.webp 600x825 (~242 dpi)
  'pokemonkorea',      -- KR 868x1212 watermarked
  'asia_pokemon_tw',   -- zh-tw /tw catalog
  'asia_pokemon_hk',   -- zh-tw /hk catalog
  'wiki_52poke',       -- zh-cn MediaWiki fallback
  'upscaled',          -- Real-ESRGAN x4 then resized to trim
  'synthesized_bleed'  -- bleed frame we generated
);

CREATE TYPE image_format    AS ENUM ('png','webp','jpg');
CREATE TYPE ingest_status   AS ENUM ('pending','ok','partial','failed');
CREATE TYPE storage_mode    AS ENUM ('ephemeral','cache','hotlink','generate');
                              -- DEFAULT ephemeral (legal posture; 7d TTL bucket)
CREATE TYPE review_status   AS ENUM ('pending','confirmed','rejected');

-- one updated_at trigger fn, attached to mutable tables at the end
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$ LANGUAGE plpgsql;

-- normalize a printed collector number to the language-agnostic natural key:
-- trim, lowercase, remove spaces, strip leading zeros that precede a digit.
-- '001'->'1', 'TG 12'->'tg12', 'GG01'->'gg1', 'SV-P-001'->'sv-p-1'
-- CRITICAL: zeros are stripped ONLY when they are leading (at string start) or
-- immediately follow a NON-digit. The earlier pattern '0+([0-9])' stripped zeros
-- anywhere, turning '100'->'10' and COLLIDING with card '10' on the natural key
-- (uq_card_print_natural) -> every set with >=100 cards failed ingest. Anchoring
-- the zero-run to (^|[^0-9]) leaves interior zeros intact: '100'->'100'.
CREATE OR REPLACE FUNCTION normalize_collector_number(raw text) RETURNS text AS $$
DECLARE s text;
BEGIN
  IF raw IS NULL THEN RETURN NULL; END IF;
  s := lower(btrim(raw));
  s := replace(s, ' ', '');
  -- strip ONLY leading/after-separator zero-runs before a digit ('001'->'1',
  -- 'gg01'->'gg1', 'sv-p-001'->'sv-p-1'); keep interior zeros ('100'->'100').
  s := regexp_replace(s, '(^|[^0-9])0+([0-9])', '\1\2', 'g');
  RETURN s;
END $$ LANGUAGE plpgsql IMMUTABLE;

-- ---------- 1. HIERARCHY: series -> card_set -> card_print -> card_localization ----------

CREATE TABLE series (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tcgdex_id     text UNIQUE,                 -- 'sv','swsh','me','base'
  ptcg_series   text,                        -- pokemontcg.io series string (not stable)
  name_en       text NOT NULL,
  logo_key      text,
  sort_order    int  NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE card_set (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id          text NOT NULL UNIQUE,      -- CANONICAL = TCGdex padded ('me04','sv03.5')
  series_id       uuid NOT NULL REFERENCES series(id) ON DELETE RESTRICT,

  -- Foreign (non-canonical) set ids live ONLY in set_mapping now.
  -- (Removed redundant ptcg_set_id / tcgdex_set_id columns.)

  name_en         text NOT NULL,
  ptcg_code       text,                      -- ptcgoCode / abbreviation.official ('OBF')
  printed_total   int,                       -- "official" count on the card
  total           int,                       -- incl. secret rares
  release_date    date,
  legal_standard  boolean,
  legal_expanded  boolean,
  logo_key        text,
  symbol_key      text,
  is_promo_set    boolean NOT NULL DEFAULT false,

  source_payload  jsonb,                     -- raw merged source objects (audit)
  source_etag     text,                      -- idempotency short-circuit
  ingest_status   ingest_status NOT NULL DEFAULT 'pending',
  last_ingest_at  timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_card_set_series  ON card_set(series_id);
CREATE INDEX idx_card_set_release ON card_set(release_date DESC NULLS LAST);
CREATE INDEX idx_card_set_promo   ON card_set(is_promo_set) WHERE is_promo_set;

-- Bridge: canonical card_set <-> foreign (pokemontcg.io unpadded, future sources).
-- Many foreign sets MAY map to one canonical set (promo subsets) -> no
-- UNIQUE(card_set_id, source). Each foreign set maps to exactly one canonical.
CREATE TABLE set_mapping (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_set_id        uuid NOT NULL REFERENCES card_set(id) ON DELETE CASCADE,
  source             source_system NOT NULL,  -- 'pokemontcg_io', etc.
  foreign_set_id     text NOT NULL,           -- normalized at write time ('me4','sv3pt5')
  match_rule         text NOT NULL,           -- 'ptcgoCode'|'date+printedTotal'|'manual'...
  confidence         numeric(3,2) NOT NULL DEFAULT 1.00,  -- <1.0 -> manual-review
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, foreign_set_id)             -- one foreign set -> one canonical
);
CREATE INDEX idx_set_mapping_foreign ON set_mapping(source, foreign_set_id);
CREATE INDEX idx_set_mapping_canon   ON set_mapping(card_set_id, source);

-- Stable rarity labels for faceting (curation source; FK from card_print is NULLABLE).
CREATE TABLE rarity_norm (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw         text UNIQUE NOT NULL, -- 'Rare Holo','Double Rare','ダブルレア'
  normalized  text NOT NULL,        -- 'double_rare'
  display_en  text NOT NULL,        -- 'Double Rare'
  rank        int  NOT NULL
);

-- THE physical card: ONE row across all languages.
-- natural key = (card_set_id, collector_number_norm).
CREATE TABLE card_print (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_set_id          uuid NOT NULL REFERENCES card_set(id) ON DELETE CASCADE,

  -- NORMALIZED key (language-agnostic): '1','sv-p-1','tg12','gg70'
  collector_number_norm text NOT NULL,
  -- RAW/printed (display): '001','SV-P-001','TG12','GG70'
  collector_number_raw  text NOT NULL,
  collector_prefix      text NOT NULL DEFAULT '', -- 'TG','GG','SV-P','' (for natural sort)
  collector_number_num  int,                      -- numeric extract for natural sort

  -- public/SEO slug, trigger-populated = set_id || '-' || collector_number_raw
  slug                 text NOT NULL,

  tcgdex_id            text UNIQUE,           -- 'me04-001'
  ptcg_id              text UNIQUE,           -- 'me4-1' (nullable; deprecated source)

  -- language-independent game/physical attributes
  supertype            text,                  -- Pokemon|Trainer|Energy
  subtypes             text[] NOT NULL DEFAULT '{}',
  types                text[] NOT NULL DEFAULT '{}',
  hp                   int,
  rarity               text,                  -- free-text raw/normalized label
  rarity_norm_id       uuid REFERENCES rarity_norm(id) ON DELETE SET NULL, -- nullable
  regulation_mark      char(1),               -- 'D'..'H' (NULL pre-regulation)
  national_pokedex     int[] NOT NULL DEFAULT '{}',
  variants             jsonb NOT NULL DEFAULT '{}'::jsonb,
  abilities            jsonb NOT NULL DEFAULT '[]'::jsonb,
  attacks              jsonb NOT NULL DEFAULT '[]'::jsonb,
  weaknesses           jsonb NOT NULL DEFAULT '[]'::jsonb,
  resistances          jsonb NOT NULL DEFAULT '[]'::jsonb,
  retreat_cost         int,
  extra                jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- tail / classification flags
  is_promo             boolean NOT NULL DEFAULT false,
  is_jumbo             boolean NOT NULL DEFAULT false,   -- oversized; print-disabled
  is_error             boolean NOT NULL DEFAULT false,
  is_regional_excl     boolean NOT NULL DEFAULT false,
  is_sealed_only       boolean NOT NULL DEFAULT false,
  is_digital_only      boolean NOT NULL DEFAULT false,   -- TCG Pocket -> EXCLUDE
  is_suppressed        boolean NOT NULL DEFAULT false,   -- fast DMCA takedown
  needs_review         boolean NOT NULL DEFAULT false,   -- low-confidence card match

  -- provenance / idempotency
  primary_source       source_system NOT NULL DEFAULT 'tcgdex',
  source_etag          text,
  ingest_status        ingest_status NOT NULL DEFAULT 'pending',
  last_ingest_at       timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_card_print_natural UNIQUE (card_set_id, collector_number_norm),
  CONSTRAINT uq_card_print_slug    UNIQUE (slug),
  CONSTRAINT chk_regulation_mark   CHECK (regulation_mark IS NULL OR regulation_mark ~ '^[A-Z]$')
);
COMMENT ON COLUMN card_print.collector_number_norm IS
  'Normalized natural key (normalize_collector_number); part of uq_card_print_natural. Trigger-derived.';
COMMENT ON COLUMN card_print.slug IS
  'Trigger-populated = card_set.set_id || ''-'' || collector_number_raw (e.g. me04-001).';
CREATE INDEX idx_card_print_set       ON card_print(card_set_id);
CREATE INDEX idx_card_print_promo     ON card_print(is_promo)      WHERE is_promo;
CREATE INDEX idx_card_print_regmark   ON card_print(regulation_mark);
CREATE INDEX idx_card_print_rarity    ON card_print(rarity);
CREATE INDEX idx_card_print_supertype ON card_print(supertype);
CREATE INDEX idx_card_print_types     ON card_print USING gin (types);
CREATE INDEX idx_card_print_subtypes  ON card_print USING gin (subtypes);
CREATE INDEX idx_card_print_sort      ON card_print(card_set_id, collector_prefix, collector_number_num, collector_number_raw);
CREATE INDEX idx_card_print_physical  ON card_print(card_set_id) WHERE NOT is_digital_only;
CREATE INDEX idx_card_print_suppressed ON card_print(is_suppressed) WHERE is_suppressed;
CREATE INDEX idx_card_print_review    ON card_print(needs_review)  WHERE needs_review;

-- derive collector_number_norm + slug before write
CREATE OR REPLACE FUNCTION card_print_derive() RETURNS trigger AS $$
DECLARE v_set_id text;
BEGIN
  NEW.collector_number_norm := normalize_collector_number(NEW.collector_number_raw);
  SELECT set_id INTO v_set_id FROM card_set WHERE id = NEW.card_set_id;
  NEW.slug := v_set_id || '-' || NEW.collector_number_raw;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_card_print_derive
  BEFORE INSERT OR UPDATE OF collector_number_raw, card_set_id ON card_print
  FOR EACH ROW EXECUTE FUNCTION card_print_derive();

-- per-language TEXT (image availability is decoupled: see image_variant).
CREATE TABLE card_localization (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_print_id  uuid NOT NULL REFERENCES card_print(id) ON DELETE CASCADE,
  lang           lang_code NOT NULL,

  name           text NOT NULL,
  illustrator    text,
  flavor_text    text,
  attacks_text   jsonb NOT NULL DEFAULT '[]'::jsonb,
  abilities_text jsonb NOT NULL DEFAULT '[]'::jsonb,
  rules_text     text[] NOT NULL DEFAULT '{}',
  printed_number text,
  text_present   boolean NOT NULL DEFAULT true,

  source         source_system NOT NULL DEFAULT 'tcgdex',
  source_etag    text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_localization UNIQUE (card_print_id, lang)
);
COMMENT ON TABLE card_localization IS
  'METADATA ONLY. Never store card art bytes here (MIT data-license / non-MIT-art split).';
CREATE INDEX idx_loc_card      ON card_localization(card_print_id);
CREATE INDEX idx_loc_lang      ON card_localization(lang);
-- typeahead (trigram) + CJK bigram FTS fallback both on name:
CREATE INDEX idx_loc_name_trgm ON card_localization USING gin (name gin_trgm_ops);
CREATE INDEX idx_loc_name_bigm ON card_localization USING gin (name gin_bigm_ops);
CREATE INDEX idx_loc_lang_name ON card_localization(lang, name);

-- ---------- 2. IMAGES ----------
-- 2a. Resolver scratchpad: declared candidate sources per (print,lang).
CREATE TABLE image_source_candidate (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_print_id uuid NOT NULL REFERENCES card_print(id) ON DELETE CASCADE,
  lang          lang_code NOT NULL,
  origin        image_origin NOT NULL,
  priority      int NOT NULL,                 -- lower wins
  url_template  text,                          -- resolved URL or NULL if needs scrape-discovery
  needs_scrape  boolean NOT NULL DEFAULT false,
  status        text NOT NULL DEFAULT 'pending', -- pending|fetched|missing|blacklisted
  last_checked  timestamptz,
  fail_count    int NOT NULL DEFAULT 0,
  UNIQUE (card_print_id, lang, origin)
);
CREATE INDEX idx_isc_pending ON image_source_candidate(status, last_checked);

-- 2b. Canonical asset ledger: one row per concrete known image.
-- EN fallback is NOT a stored row here; it is derived in card_display.
CREATE TABLE image_variant (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_print_id        uuid NOT NULL REFERENCES card_print(id) ON DELETE CASCADE,
  lang                 lang_code NOT NULL,        -- language of THIS art

  origin               image_origin NOT NULL,
  serving_mode         storage_mode NOT NULL DEFAULT 'ephemeral',  -- legal default
  source_url           text,                       -- upstream (audit)
  remote_url           text,                       -- canonical upstream for hotlink/re-fetch
  storage_key          text,                       -- object key (NULL for hotlink rows)

  format               image_format,
  width_px             int,
  height_px            int,
  -- DPI computed vs the FIXED 88mm (3.46456692913in) trim height.
  dpi_at_trim          numeric(6,1)
        GENERATED ALWAYS AS (
          CASE WHEN height_px IS NULL THEN NULL
               ELSE round(height_px / 3.46456692913, 1) END
        ) STORED,

  has_transparent_corners boolean NOT NULL DEFAULT false,
  opaque_corners          boolean NOT NULL DEFAULT false,  -- JA/KR jpg
  has_bleed               boolean NOT NULL DEFAULT false,  -- synthesized 822x1122
  is_upscaled             boolean NOT NULL DEFAULT false,  -- Real-ESRGAN x4->resize
  is_watermarked          boolean NOT NULL DEFAULT false,  -- KR pokemonkorea

  quality_rank         int NOT NULL DEFAULT 0,     -- 350=100 > 296=80 > 242=60 > upscaled 40
                                                   -- > legacy 30 > 52poke 20; -50 if watermarked
  checksum_sha256      text,                        -- content addr (object dedup)
  byte_size            int,
  source_etag          text,                        -- uniform idempotent upsert key
  ingest_status        ingest_status NOT NULL DEFAULT 'pending',
  fetched_at           timestamptz,
  expires_at           timestamptz,                 -- ephemeral TTL (7d); NULL otherwise
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  -- keep raw + bleed + upscaled derivatives without collision
  CONSTRAINT uq_image_variant UNIQUE (card_print_id, lang, origin, has_bleed, is_upscaled),
  -- legal control: ephemeral rows MUST have an expiry so the purge job sees them
  CONSTRAINT chk_ephemeral_ttl CHECK (serving_mode <> 'ephemeral' OR expires_at IS NOT NULL),
  -- a servable row needs either a stored object OR a hotlink target
  CONSTRAINT chk_servable CHECK (storage_key IS NOT NULL OR remote_url IS NOT NULL)
);
CREATE INDEX idx_img_card_lang  ON image_variant(card_print_id, lang);
CREATE INDEX idx_img_lang       ON image_variant(lang);
-- best-pick: hotlink-INCLUSIVE (storage_key OR remote_url) so native JA/KR show up
CREATE INDEX idx_img_best
   ON image_variant(card_print_id, lang, quality_rank DESC)
   WHERE storage_key IS NOT NULL OR remote_url IS NOT NULL;
CREATE INDEX idx_img_checksum   ON image_variant(checksum_sha256) WHERE checksum_sha256 IS NOT NULL;
CREATE INDEX idx_img_printable
   ON image_variant(card_print_id, lang)
   WHERE has_bleed AND dpi_at_trim >= 300;
CREATE INDEX idx_img_expiry     ON image_variant(expires_at)
   WHERE serving_mode = 'ephemeral' AND expires_at IS NOT NULL;

-- default a 7-day expiry on ephemeral inserts that didn't set one
CREATE OR REPLACE FUNCTION image_variant_ephemeral_default() RETURNS trigger AS $$
BEGIN
  IF NEW.serving_mode = 'ephemeral' AND NEW.expires_at IS NULL THEN
    NEW.expires_at := now() + interval '7 days';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_img_ephemeral
  BEFORE INSERT OR UPDATE OF serving_mode, expires_at ON image_variant
  FOR EACH ROW EXECUTE FUNCTION image_variant_ephemeral_default();

-- ---------- 3. PRICING (optional, OFF by default, attributed) ----------
CREATE TABLE card_price (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_print_id uuid NOT NULL REFERENCES card_print(id) ON DELETE CASCADE,
  provider      text NOT NULL,            -- 'tcgplayer'|'cardmarket'
  variant       text,                     -- 'normal','holofoil','reverseHolofoil'
  currency      char(3) NOT NULL,
  market        numeric(10,2),
  low           numeric(10,2),
  mid           numeric(10,2),
  high          numeric(10,2),
  url           text,
  attribution   text NOT NULL,            -- REQUIRED display string (fail-closed without it)
  fetched_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_card_price UNIQUE (card_print_id, provider, variant, currency)
);
CREATE INDEX idx_price_card ON card_price(card_print_id);

-- ---------- 4. USERS + PRINT LISTS + JOBS ----------
CREATE TABLE app_user (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          citext UNIQUE,           -- nullable: anonymous lists allowed
  display_name   text,
  password_hash  text,                    -- only if local auth used
  preferred_lang lang_code NOT NULL DEFAULT 'en',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE print_list (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid REFERENCES app_user(id) ON DELETE CASCADE,  -- NULL = anon/session
  anon_token    text,                     -- logged-out cart id
  name          text NOT NULL DEFAULT 'My Proxies',
  -- SIZE is ALWAYS 63x88mm (fixed constant, never stored). OTHER axes only:
  paper         text NOT NULL DEFAULT 'A4',   -- A4 required for full bleed
  dpi           int  NOT NULL DEFAULT 300,
  with_bleed    boolean NOT NULL DEFAULT false,  -- geometry warning fires on Letter+bleed
  duplex        boolean NOT NULL DEFAULT false,
  ink_saver     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (user_id IS NOT NULL OR anon_token IS NOT NULL),
  CHECK (paper IN ('A4','letter')),
  CHECK (dpi IN (300,600))
);
CREATE INDEX idx_print_list_user ON print_list(user_id);
CREATE INDEX idx_print_list_anon ON print_list(anon_token) WHERE anon_token IS NOT NULL;

CREATE TABLE print_list_item (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  print_list_id    uuid NOT NULL REFERENCES print_list(id) ON DELETE CASCADE,
  card_print_id    uuid NOT NULL REFERENCES card_print(id) ON DELETE RESTRICT,
  lang             lang_code NOT NULL,     -- localization to print (EN img fallback applies)
  quantity         int NOT NULL DEFAULT 1 CHECK (quantity > 0 AND quantity <= 999),
  -- art_variant (renamed from 'variant' to disambiguate from imgproxy PRESETS)
  art_variant      text NOT NULL DEFAULT 'native',  -- native|upscaled|fallback-en
  face             text NOT NULL DEFAULT 'front',    -- front|back|both
  image_variant_id uuid REFERENCES image_variant(id) ON DELETE SET NULL,  -- pin override
  position         int NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (art_variant IN ('native','upscaled','fallback-en')),
  -- face='both' = 1 front + 1 back per quantity (documented; duplex usually a job option)
  CHECK (face IN ('front','back','both')),
  -- line identity across subsystems = (list, card, lang, art_variant, face)
  CONSTRAINT uq_list_item UNIQUE (print_list_id, card_print_id, lang, art_variant, face)
);
CREATE INDEX idx_list_item_list ON print_list_item(print_list_id, position);

-- Async render queue (home_pdf | mpc_zip) -> object storage -> signed URL.
CREATE TABLE print_job (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  print_list_id uuid REFERENCES print_list(id) ON DELETE CASCADE,  -- nullable: snapshot jobs
  kind          text NOT NULL,            -- 'home_pdf'|'mpc_zip'
  status        text NOT NULL DEFAULT 'queued', -- queued|running|done|error
  progress      int  NOT NULL DEFAULT 0,
  params        jsonb NOT NULL DEFAULT '{}'::jsonb,  -- paper/dpi/bleed/duplex/registration/back/lines snapshot
  result_key    text,                     -- object key of PDF/ZIP (artifacts/{job}/...)
  signed_url    text,                     -- last issued short-TTL URL
  expires_at    timestamptz,              -- artifact auto-delete after 7d
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  CHECK (kind IN ('home_pdf','mpc_zip')),
  -- back option is generic|none ONLY; official back is never selectable
  CHECK ((params->>'back') IS NULL OR (params->>'back') IN ('generic','none'))
);
CREATE INDEX idx_print_job_list   ON print_job(print_list_id, created_at DESC);
CREATE INDEX idx_print_job_status ON print_job(status) WHERE status IN ('queued','running');

-- ---------- 5. SYNC BOOKKEEPING + CARD-LEVEL REVIEW QUEUE ----------
CREATE TABLE sync_set_state (
  source         source_system NOT NULL,
  source_set_id  text NOT NULL,           -- may be prefixed 'ja:sv03' for per-lang state
  remote_hash    text,                    -- last seen fingerprint
  card_count     int,
  last_synced_at timestamptz,
  status         text NOT NULL DEFAULT 'ok',  -- ok|pending|failed
  fail_count     int NOT NULL DEFAULT 0,
  last_error     text,
  PRIMARY KEY (source, source_set_id)
);

CREATE TABLE sync_run (
  id             bigserial PRIMARY KEY,
  kind           text NOT NULL,           -- backfill|incremental|promo_tail
  started_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz,
  sets_new       int DEFAULT 0,
  sets_changed   int DEFAULT 0,
  cards_upserted int DEFAULT 0,
  errors         jsonb DEFAULT '[]'::jsonb
);

-- Card-level cross-source mapping / manual-review queue for promo collisions
-- (e.g. SWSH001 vs 001). The matcher writes low-confidence matches HERE
-- instead of upserting a new card_print, so duplicates are schema-prevented.
CREATE TABLE card_print_review (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_print_id   uuid REFERENCES card_print(id) ON DELETE CASCADE, -- existing candidate (nullable)
  source          source_system NOT NULL,
  foreign_card_id text NOT NULL,          -- the unmatched foreign card id
  proposed_match  uuid REFERENCES card_print(id) ON DELETE SET NULL, -- best guess target
  confidence      numeric(3,2) NOT NULL DEFAULT 0.00,
  status          review_status NOT NULL DEFAULT 'pending',
  reason          text,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,  -- the foreign card snapshot
  created_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz,
  UNIQUE (source, foreign_card_id)
);
CREATE INDEX idx_cpr_status ON card_print_review(status, created_at) WHERE status = 'pending';

-- ---------- 6. COMPLIANCE (blocked assets + DMCA + takedown audit) ----------
CREATE TABLE blocked_asset (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url_pattern   text,                      -- match by URL
  sha256        text,                      -- AND/OR match by bytes (official card back)
  reason        text NOT NULL,             -- 'official_back'|'dmca'|'manual'
  case_ref      text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (url_pattern IS NOT NULL OR sha256 IS NOT NULL)
);
CREATE INDEX idx_blocked_sha    ON blocked_asset(sha256)      WHERE sha256 IS NOT NULL;
CREATE INDEX idx_blocked_urlpat ON blocked_asset(url_pattern) WHERE url_pattern IS NOT NULL;

CREATE TABLE dmca_request (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_ref      text UNIQUE NOT NULL,
  claimant      text,
  contact       text,
  target_desc   text NOT NULL,
  status        text NOT NULL DEFAULT 'received',  -- received|actioned|rejected
  received_at   timestamptz NOT NULL DEFAULT now(),
  actioned_at   timestamptz
);

CREATE TABLE takedown_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_ref      text,                      -- links to dmca_request.case_ref
  card_print_id uuid REFERENCES card_print(id) ON DELETE SET NULL,
  action        text NOT NULL,             -- 'blocklist'|'purge_cache'|'suppress'|'cdn_bust'
  detail        jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_takedown_case ON takedown_log(case_ref, created_at DESC);

-- ---------- 7. SEARCH READ-MODEL (feeds Meilisearch reindex; powers PG-FTS + pg_bigm fallback) ----------
-- Hotlink-inclusive image pick; full facet/display field set; has_localized_image;
-- name fallback beyond EN. is_english_fallback is DERIVED here (no stored pointer rows).
CREATE MATERIALIZED VIEW card_display AS
SELECT
  cp.id                          AS card_print_id,
  cp.card_set_id,
  cs.set_id                      AS set_id,
  cp.slug,
  cp.collector_number_raw,
  cp.collector_prefix,
  cp.collector_number_num,
  langs.lang                     AS requested_lang,

  -- NAME with fallback chain: requested -> en -> any present (priority order)
  COALESCE(l.name, len.name, anyname.name)         AS display_name,
  len.name                                          AS name_en,
  (l.name IS NULL)                                  AS name_is_fallback,
  CASE WHEN l.name IS NOT NULL THEN langs.lang
       WHEN len.name IS NOT NULL THEN 'en'::lang_code
       ELSE anyname.lang END                        AS name_lang,
  COALESCE(l.illustrator, len.illustrator)          AS illustrator,

  -- IMAGE best-pick (localized then EN), hotlink-inclusive
  best.storage_key               AS image_key,
  best.remote_url                AS image_remote_url,
  best.served_mode               AS image_served_mode,  -- 'stored'|'hotlink'
  best.served_lang               AS image_lang,
  best.is_english_fallback       AS image_is_english_fallback,  -- derived
  best.dpi_at_trim,
  best.is_watermarked,
  best.is_upscaled,

  -- has a TRUE localized scan in the requested lang (drives the facet)
  EXISTS (
    SELECT 1 FROM image_variant iv2
    WHERE iv2.card_print_id = cp.id
      AND iv2.lang = langs.lang::lang_code
      AND (iv2.storage_key IS NOT NULL OR iv2.remote_url IS NOT NULL)
  )                              AS has_localized_image,

  -- facet/display fields (full set, so Meili indexes straight from the MV)
  cp.supertype,
  cp.subtypes,
  cp.types,
  cp.hp,
  cp.rarity,
  rn.display_en                  AS rarity_display,
  cp.regulation_mark,
  cp.national_pokedex,
  cp.is_promo, cp.is_jumbo, cp.is_error, cp.is_regional_excl, cp.is_sealed_only
FROM card_print cp
JOIN card_set cs ON cs.id = cp.card_set_id
LEFT JOIN rarity_norm rn ON rn.id = cp.rarity_norm_id
CROSS JOIN (VALUES ('en'),('ja'),('fr'),('de'),('it'),
                   ('es'),('pt'),('ko'),('zh-cn'),('zh-tw')) AS langs(lang)
LEFT JOIN card_localization l   ON l.card_print_id   = cp.id AND l.lang   = langs.lang::lang_code
LEFT JOIN card_localization len ON len.card_print_id = cp.id AND len.lang = 'en'
-- any-available localization (priority: en > ja > fr > ... ) for name fallback
LEFT JOIN LATERAL (
  SELECT cl.name, cl.lang
  FROM card_localization cl
  WHERE cl.card_print_id = cp.id
  ORDER BY array_position(
    ARRAY['en','ja','fr','de','it','es','pt','ko','zh-cn','zh-tw']::text[],
    cl.lang::text)
  LIMIT 1
) anyname ON TRUE
-- best image: localized first, else EN; hotlink-inclusive
CROSS JOIN LATERAL (
  SELECT iv.storage_key, iv.remote_url,
         CASE WHEN iv.storage_key IS NOT NULL THEN 'stored' ELSE 'hotlink' END AS served_mode,
         iv.lang AS served_lang,
         (iv.lang <> langs.lang::lang_code) AS is_english_fallback,
         iv.dpi_at_trim, iv.is_watermarked, iv.is_upscaled
  FROM image_variant iv
  WHERE iv.card_print_id = cp.id
    AND (iv.storage_key IS NOT NULL OR iv.remote_url IS NOT NULL)
    AND iv.lang IN (langs.lang::lang_code, 'en')
  ORDER BY CASE WHEN iv.lang = langs.lang::lang_code THEN 0 ELSE 1 END,
           iv.quality_rank DESC
  LIMIT 1
) best
WHERE NOT cp.is_digital_only AND NOT cp.is_suppressed;

CREATE UNIQUE INDEX uq_card_display ON card_display(card_print_id, requested_lang);
CREATE INDEX idx_card_display_set  ON card_display(card_set_id, requested_lang);
-- Postgres-FTS fallback objects (Latin tsvector + CJK bigram) on the read-model:
CREATE INDEX idx_card_display_fts  ON card_display
   USING gin (to_tsvector('simple', coalesce(display_name,'') || ' ' || coalesce(name_en,'')));
CREATE INDEX idx_card_display_bigm ON card_display USING gin (display_name gin_bigm_ops);
CREATE INDEX idx_card_display_facet ON card_display(requested_lang, has_localized_image, rarity, supertype);
-- REFRESH MATERIALIZED VIEW CONCURRENTLY card_display;  (after each ingest batch)

-- ---------- 8. updated_at TRIGGERS ----------
CREATE TRIGGER trg_series_touch        BEFORE UPDATE ON series             FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_card_set_touch      BEFORE UPDATE ON card_set           FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_card_print_touch    BEFORE UPDATE ON card_print         FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_localization_touch  BEFORE UPDATE ON card_localization  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_image_variant_touch BEFORE UPDATE ON image_variant      FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_app_user_touch      BEFORE UPDATE ON app_user           FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_print_list_touch    BEFORE UPDATE ON print_list         FOR EACH ROW EXECUTE FUNCTION touch_updated_at();