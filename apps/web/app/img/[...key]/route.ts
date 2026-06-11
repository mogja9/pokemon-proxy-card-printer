import { readFile } from 'node:fs/promises';
import { imagesBaseDir, safeImagePath } from '@proxyforge/print';

export const runtime = 'nodejs';

/** Serve stored card images (LocalFsStorage). storage_key = src/{origin}/{lang}/{set}/{num}.png */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ key: string[] }> },
): Promise<Response> {
  const { key } = await params;
  const rel = key.join('/');
  // shared (tested) base-dir + traversal guard - the SAME logic the print/render
  // path uses, so where the pipeline WRITES is exactly where this READS.
  const path = safeImagePath(imagesBaseDir(), rel);
  if (!path) return new Response('bad request', { status: 400 });
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
