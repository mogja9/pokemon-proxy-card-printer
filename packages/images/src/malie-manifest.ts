/**
 * malie.io manifest-driven URL resolution.
 *
 * The blind URL builder in sources.ts constructs a plausible malie URL for every
 * Western-lang card, but malie only carries ~28 TCGL/SV+Mega-era sets - so for
 * older sets every malie fetch 404s before falling through to TCGdex. This
 * module reads malie's own manifest so we (a) SKIP malie entirely for sets it
 * does not have, and (b) use the AUTHORITATIVE image URL for the sets it does.
 *
 * Manifest shape (verified 2026-06-11):
 *   {locale}.index.json: { "<locale>": { "<setId>": { path, name, num, abbr } } }
 *   per-set file (array): [{ collector_number: { numerator }, images: { tcgl: {
 *                            png: { front: "<url>" } } } }, ...]
 * Duplicate collector numbers (foil variants) resolve to the same std PNG.
 *
 * fetchJson is injectable so the parsers + caching are unit-tested without network.
 */
import { canonicalToMalieSetId } from './sources.js';

/**
 * - found:   authoritative URL (use it).
 * - absent:  the set/card is definitively NOT on malie (drop the malie candidate).
 * - unknown: the manifest could not be consulted (keep the constructed-URL
 *            fallback so a transient outage does not strip malie everywhere).
 */
export type MalieLookup =
  | { status: 'found'; url: string }
  | { status: 'absent' }
  | { status: 'unknown' };

export interface MalieResolver {
  lookup(lang: string, setId: string, localId: string): Promise<MalieLookup>;
}

const DEFAULT_BASE = 'https://cdn.malie.io/file/malie-io/tcgl/export';

/** our lang code -> malie manifest locale key (Western game-client langs only). */
const LANG_LOCALE: Record<string, string> = {
  en: 'en-US',
  fr: 'fr-FR',
  de: 'de-DE',
  it: 'it-IT',
  es: 'es-ES',
};

export function malieLocale(lang: string): string | null {
  return LANG_LOCALE[lang] ?? null;
}

/** numerator key form: 3-digit zero-pad for pure numerics, else passthrough. */
function malieNum(localId: string): string {
  return /^\d+$/.test(localId) ? localId.padStart(3, '0') : localId;
}

/** index.json -> Map<setId, perSetPath> for one locale. */
export function parseIndex(json: unknown, locale: string): Map<string, string> {
  const root = (json as Record<string, Record<string, { path?: unknown }>> | null)?.[locale] ?? {};
  const out = new Map<string, string>();
  for (const [setId, entry] of Object.entries(root)) {
    if (entry && typeof entry.path === 'string') out.set(setId, entry.path);
  }
  return out;
}

/** per-set card array -> Map<numerator, pngFrontUrl> (first wins; dups agree). */
export function parseSetCards(json: unknown): Map<string, string> {
  const arr = Array.isArray(json) ? json : [];
  const out = new Map<string, string>();
  for (const c of arr) {
    const num = c?.collector_number?.numerator;
    const url = c?.images?.tcgl?.png?.front;
    if (typeof num === 'string' && typeof url === 'string' && !out.has(num)) {
      out.set(num, url);
    }
  }
  return out;
}

export type FetchJson = (url: string) => Promise<unknown>;

export class MalieManifest implements MalieResolver {
  private readonly base: string;
  private readonly fetchJson: FetchJson;
  private readonly indexCache = new Map<string, Promise<Map<string, string>>>();
  private readonly setCache = new Map<string, Promise<Map<string, string>>>();

  constructor(opts: { fetchJson?: FetchJson; baseUrl?: string } = {}) {
    this.base = opts.baseUrl ?? DEFAULT_BASE;
    this.fetchJson =
      opts.fetchJson ??
      (async (url) => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`malie manifest ${res.status} for ${url}`);
        return res.json();
      });
  }

  private getIndex(locale: string): Promise<Map<string, string>> {
    let p = this.indexCache.get(locale);
    if (!p) {
      p = this.fetchJson(`${this.base}/index.json`).then((j) => parseIndex(j, locale));
      this.indexCache.set(locale, p);
    }
    return p;
  }

  private getSetCards(path: string): Promise<Map<string, string>> {
    let p = this.setCache.get(path);
    if (!p) {
      p = this.fetchJson(`${this.base}/${path}`).then(parseSetCards);
      this.setCache.set(path, p);
    }
    return p;
  }

  async lookup(lang: string, setId: string, localId: string): Promise<MalieLookup> {
    const locale = malieLocale(lang);
    if (!locale) return { status: 'absent' }; // non-Western lang -> no malie art
    let index: Map<string, string>;
    try {
      index = await this.getIndex(locale);
    } catch {
      return { status: 'unknown' }; // manifest unreachable -> keep fallback
    }
    const path = index.get(canonicalToMalieSetId(setId));
    if (!path) return { status: 'absent' }; // set not on malie
    try {
      const cards = await this.getSetCards(path);
      const url = cards.get(malieNum(localId));
      return url ? { status: 'found', url } : { status: 'absent' };
    } catch {
      return { status: 'unknown' };
    }
  }
}

/**
 * Rewrite a candidate list using the manifest: replace each malie candidate's
 * URL with the authoritative one (found), drop it (absent), or keep the
 * constructed-URL fallback (unknown). Non-malie candidates pass through.
 */
export async function applyMalieManifest<T extends { origin: string; lang: string; url: string }>(
  candidates: T[],
  setId: string,
  localId: string,
  resolver: MalieResolver,
): Promise<T[]> {
  const out: T[] = [];
  for (const cand of candidates) {
    if (cand.origin !== 'malie_io') {
      out.push(cand);
      continue;
    }
    const r = await resolver.lookup(cand.lang, setId, localId);
    if (r.status === 'found') out.push({ ...cand, url: r.url });
    else if (r.status === 'unknown') out.push(cand);
    // absent -> drop the malie candidate
  }
  return out;
}
