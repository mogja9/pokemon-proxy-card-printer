import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export const runtime = 'nodejs';

/** Serve stored card images (LocalFsStorage). storage_key = src/{origin}/{lang}/{set}/{num}.png */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ key: string[] }> },
): Promise<Response> {
  const { key } = await params;
  const rel = key.join('/');
  if (rel.includes('..')) return new Response('bad request', { status: 400 });
  const base = process.env.IMAGES_DIR ? resolve(process.env.IMAGES_DIR) : resolve(process.cwd(), 'data/images');
  const path = join(base, rel);
  if (!path.startsWith(base)) return new Response('bad request', { status: 400 });
  try {
    const buf = await readFile(path);
    return new Response(new Uint8Array(buf), {
      headers: {
        'content-type': rel.endsWith('.webp') ? 'image/webp' : 'image/png',
        'cache-control': 'public, max-age=86400, immutable',
      },
    });
  } catch {
    return new Response('not found', { status: 404 });
  }
}
