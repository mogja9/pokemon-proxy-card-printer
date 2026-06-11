import type { NextRequest } from 'next/server';
import { resolveDeckList } from '@proxyforge/print';
import { LAUNCH_LANGS, type Lang } from '@proxyforge/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST { text, lang } -> { resolved: [...], unresolved: [...] }. */
export async function POST(req: NextRequest): Promise<Response> {
  let body: { text?: string; lang?: string };
  try {
    body = await req.json();
  } catch {
    return new Response('invalid JSON', { status: 400 });
  }
  const text = typeof body.text === 'string' ? body.text : '';
  if (!text.trim()) return new Response('empty decklist', { status: 400 });
  const lang: Lang = (LAUNCH_LANGS as readonly string[]).includes(body.lang ?? '')
    ? (body.lang as Lang)
    : 'en';
  try {
    const result = await resolveDeckList(text, lang);
    return Response.json(result);
  } catch (err) {
    return new Response(
      `deck resolution failed: ${err instanceof Error ? err.message : String(err)}`,
      { status: 500 },
    );
  }
}
