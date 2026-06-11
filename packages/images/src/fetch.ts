import { createHash } from 'node:crypto';
import sharp from 'sharp';

const UA = 'ProxyForge/0.1 (+image-pipeline; fan tool, non-commercial)';

export interface FetchedImage {
  bytes: Buffer;
  contentType: string;
}

/** GET an image. null on 404 (terminal). Throws on other failures. fetchImpl is
 *  injectable for tests; defaults to the global fetch. */
export async function fetchImageBytes(
  url: string,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<FetchedImage | null> {
  const { timeoutMs = 20000, fetchImpl = fetch } = opts;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal, headers: { 'user-agent': UA } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`image fetch ${res.status} for ${url}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    return { bytes, contentType: res.headers.get('content-type') ?? 'image/png' };
  } finally {
    clearTimeout(timer);
  }
}

export interface ImageMeta {
  width: number;
  height: number;
  hasAlpha: boolean;
}

export async function probeImage(bytes: Buffer): Promise<ImageMeta> {
  const m = await sharp(bytes).metadata();
  return { width: m.width ?? 0, height: m.height ?? 0, hasAlpha: Boolean(m.hasAlpha) };
}

export function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** DPI at the fixed 88mm trim height, matching schema's generated column. */
export function dpiAtTrim(heightPx: number): number {
  return Math.round((heightPx / 3.46456692913) * 10) / 10;
}
