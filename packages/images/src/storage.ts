/**
 * Object storage abstraction. LocalFsStorage is the runnable $0 default (writes
 * under data/images); the S3/SeaweedFS backend (production, per architecture)
 * implements the same interface and drops in via STORAGE_BACKEND. Keys follow
 * `src/{origin}/{lang}/{set}/{collector}.{ext}`.
 */
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';

export interface Storage {
  /** persist bytes at key; returns the key. */
  put(key: string, bytes: Buffer, contentType: string): Promise<string>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  /** a URL the web tier can serve this key from. */
  url(key: string): string;
}

export class LocalFsStorage implements Storage {
  constructor(private readonly baseDir: string = resolve(process.cwd(), 'data/images')) {}

  private path(key: string): string {
    return join(this.baseDir, key);
  }

  async put(key: string, bytes: Buffer): Promise<string> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, bytes);
    return key;
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(this.path(key));
      return true;
    } catch {
      return false;
    }
  }

  url(key: string): string {
    return `/img/${key}`;
  }
}

/** Factory. Today: local FS. STORAGE_BACKEND=s3 will return an S3Storage. */
export function createStorage(env: NodeJS.ProcessEnv = process.env): Storage {
  const backend = env.STORAGE_BACKEND ?? 'local';
  if (backend === 's3') {
    throw new Error(
      'S3/SeaweedFS storage backend not wired yet (Phase 2 prod); set STORAGE_BACKEND=local',
    );
  }
  return new LocalFsStorage(env.IMAGES_DIR ? resolve(env.IMAGES_DIR) : undefined);
}
