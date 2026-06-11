import type { NextRequest } from 'next/server';
import { renderHomePdf, renderMpcZip, loadPrintImageBytes, type PrintItem } from '@proxyforge/print';
import { query } from '@proxyforge/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<Response> {
  let body: {
    items?: { slug: string; lang: string; qty: number }[];
    target?: string;
    paper?: string;
    dpi?: number;
    bleed?: boolean;
    gutter?: number;
  };
  try {
    body = await req.json();
  } catch {
    return new Response('invalid JSON', { status: 400 });
  }
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return new Response('empty print list', { status: 400 });

  const printItems: PrintItem[] = [];
  for (const it of items.slice(0, 600)) {
    const res = await query<{ storage_key: string | null; remote_url: string | null }>(
      `SELECT img.storage_key, img.remote_url
       FROM card_print cp
       LEFT JOIN LATERAL (
         SELECT iv.storage_key, iv.remote_url
         FROM image_variant iv
         WHERE iv.card_print_id = cp.id AND iv.lang IN ($2, 'en')
           AND (iv.storage_key IS NOT NULL OR iv.remote_url IS NOT NULL)
           AND NOT iv.has_bleed
         ORDER BY CASE WHEN iv.lang = $2 THEN 0 ELSE 1 END, iv.quality_rank DESC,
                  (iv.storage_key IS NOT NULL) DESC, iv.id
         LIMIT 1
       ) img ON TRUE
       WHERE cp.slug = $1 AND NOT cp.is_suppressed
       LIMIT 1`,
      [it.slug, it.lang],
    );
    const row = res.rows[0];
    if (!row) continue;
    const buf = await loadPrintImageBytes(row.storage_key, row.remote_url);
    if (!buf) continue;
    printItems.push({
      image: buf,
      quantity: Math.max(1, Math.min(999, Number(it.qty) || 1)),
      label: `${it.slug}_${it.lang}`,
    });
  }
  if (!printItems.length) return new Response('no resolvable images for these cards', { status: 400 });

  const dpi = body.dpi === 600 ? 600 : 300;
  // surface render-time warnings to the client (clipping, paper switch, MPC
  // over-capacity) via an ASCII-safe header; the body is the binary artifact.
  const warnHeader = (msgs: string[]): Record<string, string> =>
    msgs.length ? { 'x-render-warnings': encodeURIComponent(msgs.join(' | ')) } : {};

  if (body.target === 'mpc') {
    const r = await renderMpcZip(printItems, { dpi });
    const warnings = r.exceedsCapacity
      ? [
          `${r.totalCards} cards exceeds MakePlayingCards' largest single order (${r.bracket}); ` +
            `split the list into multiple orders.`,
        ]
      : [];
    return new Response(new Uint8Array(r.zip), {
      headers: {
        'content-type': 'application/zip',
        'content-disposition': 'attachment; filename="proxies-mpc.zip"',
        ...warnHeader(warnings),
      },
    });
  }
  const r = await renderHomePdf(printItems, {
    paper: body.paper === 'letter' ? 'letter' : 'A4',
    dpi,
    withBleed: Boolean(body.bleed),
    gutterMm: Number.isFinite(body.gutter) ? Number(body.gutter) : 4,
  });
  return new Response(new Uint8Array(r.pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': 'attachment; filename="proxies.pdf"',
      ...warnHeader(r.warnings),
    },
  });
}
