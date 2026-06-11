/**
 * @proxyforge/config - typed environment + the single source of truth for the
 * compliance posture. Keep this dependency-free so every package can import it.
 */

/** The 10 launch languages. `pt` = Portugal Portuguese, NEVER `pt-br`. */
export const LAUNCH_LANGS = [
  'en',
  'ja',
  'fr',
  'de',
  'it',
  'es',
  'pt',
  'ko',
  'zh-cn',
  'zh-tw',
] as const;
export type Lang = (typeof LAUNCH_LANGS)[number];

/**
 * Western languages share TCGdex set IDs, so they collapse into ONE card_print
 * row (per-language localizations). ja/ko/zh-* have different set structures and
 * become their own card_print rows (distinct physical printings).
 */
export const WESTERN_LANGS: readonly Lang[] = ['en', 'fr', 'de', 'it', 'es', 'pt'];

/**
 * The ONE physical card size. Fixed, universal, competitive/standard. Never
 * stored per-row, never user-editable. DPI is a SEPARATE axis (image sharpness).
 */
export const CARD_SIZE_MM = { width: 63, height: 88 } as const;
export const CARD_SIZE_IN = {
  width: 63 / 25.4, // 2.4803...
  height: 88 / 25.4, // 3.46456692913...
} as const;

/** px = round(mm / 25.4 * dpi). The only place DPI touches geometry. */
export function mmToPx(mm: number, dpi: number): number {
  return Math.round((mm / 25.4) * dpi);
}

export type OverlayAdapter = 'none' | 'ptcgio' | 'scrydex';
export type ServingMode = 'ephemeral' | 'cache' | 'hotlink' | 'generate';
export type CardBack = 'none' | 'generic';

function envStr(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  const v = env[key];
  return v === undefined || v === '' ? fallback : v;
}
function envBool(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const v = env[key];
  if (v === undefined || v === '') return fallback;
  return v === 'true' || v === '1' || v === 'yes';
}
function envNum(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const v = env[key];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function parseLangs(raw: string): Lang[] {
  const set = new Set(LAUNCH_LANGS as readonly string[]);
  const out: Lang[] = [];
  for (const part of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (!set.has(part)) {
      throw new Error(
        `LAUNCH_LANGS contains unsupported language '${part}'. Allowed: ${LAUNCH_LANGS.join(', ')}`,
      );
    }
    out.push(part as Lang);
  }
  return out.length ? out : [...LAUNCH_LANGS];
}

export interface AppConfig {
  databaseUrl: string;
  tcgdexBaseUrl: string;
  launchLangs: Lang[];
  overlayAdapter: OverlayAdapter;
  pokemontcgIoApiKey: string;
  ingest: { tcgdexRps: number; scrapeRps: number };
  search: { backend: 'meili' | 'pg'; meiliUrl: string; meiliMasterKey: string };
  storage: {
    endpoint: string;
    accessKey: string;
    secretKey: string;
    bucketSource: string;
    bucketArtifacts: string;
  };
  redisUrl: string;
}

/** Read + validate environment once. Throws on clearly-broken config. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const overlay = envStr(env, 'OVERLAY_ADAPTER', 'none') as OverlayAdapter;
  if (!['none', 'ptcgio', 'scrydex'].includes(overlay)) {
    throw new Error(`OVERLAY_ADAPTER must be none|ptcgio|scrydex, got '${overlay}'`);
  }
  const backend = envStr(env, 'SEARCH_BACKEND', 'meili') as 'meili' | 'pg';
  return {
    databaseUrl: envStr(env, 
      'DATABASE_URL',
      'postgresql://proxyforge:change_me_locally@localhost:5432/proxyforge',
    ),
    tcgdexBaseUrl: envStr(env, 'TCGDEX_BASE_URL', 'https://api.tcgdex.net/v2').replace(/\/$/, ''),
    launchLangs: parseLangs(envStr(env, 'LAUNCH_LANGS', LAUNCH_LANGS.join(','))),
    overlayAdapter: overlay,
    pokemontcgIoApiKey: envStr(env, 'POKEMONTCG_IO_API_KEY', ''),
    ingest: {
      tcgdexRps: envNum(env, 'INGEST_TCGDEX_RPS', 4),
      scrapeRps: envNum(env, 'INGEST_SCRAPE_RPS', 0.5),
    },
    search: {
      backend: backend === 'pg' ? 'pg' : 'meili',
      meiliUrl: envStr(env, 'MEILI_URL', 'http://localhost:7700'),
      meiliMasterKey: envStr(env, 'MEILI_MASTER_KEY', 'change_me_locally'),
    },
    storage: {
      endpoint: envStr(env, 'S3_ENDPOINT', 'http://localhost:8333'),
      accessKey: envStr(env, 'S3_ACCESS_KEY', 'proxyforge'),
      secretKey: envStr(env, 'S3_SECRET_KEY', 'change_me_locally'),
      bucketSource: envStr(env, 'S3_BUCKET_SOURCE', 'pf-src'),
      bucketArtifacts: envStr(env, 'S3_BUCKET_ARTIFACTS', 'pf-artifacts'),
    },
    redisUrl: envStr(env, 'REDIS_URL', 'redis://localhost:6379'),
  };
}

/**
 * Compliance posture - the single source of truth (architecture sec.10). A CI
 * spec test should fail the build if production defaults drift from these.
 */
export interface ComplianceConfig {
  /** generate-don't-host: default storage mode for fetched images. */
  defaultServingMode: ServingMode;
  /** TTL (days) for ephemeral images. */
  ephemeralTtlDays: number;
  /** site-wide noindex / robots Disallow. */
  noindex: boolean;
  /** pricing OFF by default (TCGplayer terms forbid commercial redistribution). */
  pricingEnabled: boolean;
  /** official card back is NEVER selectable. */
  cardBack: CardBack;
  /** never reproduce / serve the official card back. */
  blockOfficialBack: boolean;
  /** never strip the Korean watermark. */
  preserveKrWatermark: boolean;
  /** proxies are not tournament-legal; surfaced in UI + PDF/ZIP. */
  notTournamentLegal: boolean;
  /** brand slots must not contain trademarked terms (CI brand-lint enforces). */
  trademarkedTermsBanned: readonly string[];
}

export function loadCompliance(env: NodeJS.ProcessEnv = process.env): ComplianceConfig {
  return {
    defaultServingMode: envStr(env, 'COMPLIANCE_DEFAULT_SERVING_MODE', 'ephemeral') as ServingMode,
    ephemeralTtlDays: envNum(env, 'COMPLIANCE_EPHEMERAL_TTL_DAYS', 7),
    noindex: envBool(env, 'COMPLIANCE_NOINDEX', true),
    pricingEnabled: envBool(env, 'COMPLIANCE_PRICING_ENABLED', false),
    cardBack: envStr(env, 'COMPLIANCE_CARD_BACK', 'none') as CardBack,
    blockOfficialBack: true,
    preserveKrWatermark: true,
    notTournamentLegal: true,
    // Keep in sync with scripts/brand-lint.mjs BANNED (the CI enforcer). Unifying
    // into one source is a follow-up (the .mjs cannot import this TS module
    // without a build step); see docs/OPEN_ITEMS.md.
    trademarkedTermsBanned: [
      'pokemon',
      'pokémon',
      'poké',
      'pokeball',
      'poke-ball',
      'nintendo',
      'gamefreak',
    ],
  };
}

/** Asserts the running compliance config matches the safe defaults (CI gate). */
export function assertSafeComplianceDefaults(c: ComplianceConfig): void {
  const problems: string[] = [];
  if (c.defaultServingMode !== 'ephemeral' && c.defaultServingMode !== 'generate') {
    problems.push(`defaultServingMode must be ephemeral|generate, got ${c.defaultServingMode}`);
  }
  if (c.pricingEnabled) problems.push('pricingEnabled must be false by default');
  if (c.cardBack !== 'none' && c.cardBack !== 'generic') {
    problems.push(`cardBack must be none|generic, got ${c.cardBack}`);
  }
  if (!c.blockOfficialBack) problems.push('blockOfficialBack must be true');
  if (!c.noindex) problems.push('noindex should be true by default (low profile)');
  if (problems.length) {
    throw new Error('Unsafe compliance defaults:\n - ' + problems.join('\n - '));
  }
}
