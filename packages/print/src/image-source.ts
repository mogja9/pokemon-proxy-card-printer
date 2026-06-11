/**
 * Load image bytes for rendering, preferring the LOCAL stored copy (storage_key)
 * over re-fetching the third-party remote_url. Shared by the print CLI/resolver
 * and the web render route so the "stored-then-hotlink" policy lives in ONE place.
 *
 * Today storage is local FS (data/images, IMAGES_DIR override); the S3/SeaweedFS
 * backend will slot in behind the same call site later.
 */
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const UA = 'ProxyForge/0.1 (+print)';

/** Base directory for the local image store (IMAGES_DIR or ./data/images). */
export function imagesBaseDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.IMAGES_DIR ? resolve(env.IMAGES_DIR) : resolve(process.cwd(), 'data/images');
}

/**
 * Resolve a storage key to an absolute path under `base`, or null if it would
 * escape the base directory (path-traversal guard). Pure + unit-tested.
 */
export function safeImagePath(base: string, storageKey: string): string | null {
  if (storageKey.includes('..')) return null;
  const path = join(base, storageKey);
  return path.startsWith(base) ? path : null;
}

/**
 * Bytes for a (storage_key, remote_url) pair: try the local stored copy first,
 * fall back to the remote hotlink. Returns null if neither yields bytes (caller
 * treats that as a missing image rather than aborting the whole job).
 */
export async function loadPrintImageBytes(
  storageKey: string | null,
  remoteUrl: string | null,
): Promise<Buffer | null> {
  if (storageKey) {
    const path = safeImagePath(imagesBaseDir(), storageKey);
    if (path) {
      try {
        return await readFile(path);
      } catch {
        /* not on disk yet - fall through to the remote hotlink */
      }
    }
  }
  if (remoteUrl) {
    try {
      const res = await fetch(remoteUrl, { headers: { 'user-agent': UA } });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
    } catch {
      /* network-level failure - treat as missing */
    }
  }
  return null;
}
