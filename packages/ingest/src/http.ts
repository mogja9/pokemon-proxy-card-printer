/**
 * Polite HTTP: a per-instance rate limiter + retrying JSON fetch. 404 is terminal
 * (returns null); 5xx/429/network retry with exponential backoff. Honors the
 * spec's "never hammer" rule via requests-per-second pacing.
 */

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** Serialize calls to at most `rps` per second (min-interval gate). */
export class RateLimiter {
  private readonly minIntervalMs: number;
  private chain: Promise<void> = Promise.resolve();
  private last = 0;

  constructor(rps: number) {
    this.minIntervalMs = rps > 0 ? 1000 / rps : 0;
  }

  /** Resolve after enough time has passed since the previous slot. */
  async acquire(): Promise<void> {
    const prev = this.chain;
    let release!: () => void;
    this.chain = new Promise<void>((r) => (release = r));
    await prev;
    const wait = this.last + this.minIntervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    this.last = Date.now();
    release();
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface FetchOptions {
  limiter?: RateLimiter;
  timeoutMs?: number;
  retries?: number;
  browserUa?: boolean;
  headers?: Record<string, string>;
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * GET JSON with retry. Returns `null` on 404 (terminal "not found"). Throws
 * HttpError after exhausting retries on other failures.
 */
export async function fetchJson<T>(url: string, opts: FetchOptions = {}): Promise<T | null> {
  const { limiter, timeoutMs = 20000, retries = 4, browserUa = false, headers = {} } = opts;
  let attempt = 0;
  let lastErr: unknown;

  while (attempt <= retries) {
    if (limiter) await limiter.acquire();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: {
          accept: 'application/json',
          ...(browserUa ? { 'user-agent': BROWSER_UA } : {}),
          ...headers,
        },
      });
      if (res.status === 404) return null; // terminal
      if (res.status === 429 || res.status >= 500) {
        throw new HttpError(`HTTP ${res.status} for ${url}`, res.status);
      }
      if (!res.ok) throw new HttpError(`HTTP ${res.status} for ${url}`, res.status);
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err;
      // 4xx (non-429) are terminal: do not retry
      if (err instanceof HttpError && err.status < 500 && err.status !== 429) throw err;
      attempt += 1;
      if (attempt > retries) break;
      await sleep(Math.min(15000, 500 * 2 ** (attempt - 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`fetchJson failed for ${url}: ${String(lastErr)}`);
}
