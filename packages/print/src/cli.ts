/**
 * Print CLI.
 *
 *   # from a print_list in the DB:
 *   npm run print -- pdf  --list <uuid> --out deck.pdf --paper A4 --dpi 300 --bleed
 *   npm run print -- mpc  --list <uuid> --out deck.zip --dpi 300
 *
 *   # standalone from image URLs (demo / no DB):
 *   npm run print -- pdf --urls https://.../high.png,https://.../high.png --out demo.pdf
 */
import { writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { closePool } from '@proxyforge/db';
import { renderHomePdf, type PrintItem } from './homepdf.js';
import { renderMpcZip } from './mpc.js';
import { resolvePrintList, fetchImageBuffer } from './resolve.js';
import type { Paper, Dpi } from './geometry.js';

function flagVal(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}
function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(`--${name}`);
}

async function itemsFromUrls(csv: string): Promise<PrintItem[]> {
  const urls = csv.split(',').map((s) => s.trim()).filter(Boolean);
  const items: PrintItem[] = [];
  for (const url of urls) {
    items.push({ image: await fetchImageBuffer(url), quantity: 1, label: basename(new URL(url).pathname) || 'card' });
  }
  return items;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0] ?? 'pdf';
  const out = flagVal(argv, 'out') ?? (cmd === 'mpc' ? 'out.zip' : 'out.pdf');
  const paper = (flagVal(argv, 'paper') as Paper) ?? 'A4';
  const dpi = (Number(flagVal(argv, 'dpi') ?? '300') as Dpi) === 600 ? 600 : 300;

  const urls = flagVal(argv, 'urls');
  const listId = flagVal(argv, 'list');
  let items: PrintItem[];
  if (urls) {
    items = await itemsFromUrls(urls);
  } else if (listId) {
    const r = await resolvePrintList(listId);
    if (r.missing.length) {
      console.warn(`[print] ${r.missing.length} items had no resolvable image (skipped)`);
    }
    items = r.items;
  } else {
    throw new Error('provide --urls <csv> or --list <print_list_uuid>');
  }
  if (!items.length) throw new Error('no printable items');

  if (cmd === 'mpc') {
    const res = await renderMpcZip(items, { dpi });
    await writeFile(out, res.zip);
    console.log(
      `[print] wrote ${out}: ${res.totalCards} cards, bracket ${res.bracket}, ${res.canvasPx.w}x${res.canvasPx.h}px each`,
    );
  } else {
    const res = await renderHomePdf(items, {
      paper,
      dpi,
      withBleed: hasFlag(argv, 'bleed'),
      inkSaver: hasFlag(argv, 'ink-saver'),
    });
    for (const w of res.warnings) console.warn(`[print] WARN: ${w}`);
    await writeFile(out, res.pdf);
    console.log(`[print] wrote ${out}: ${res.pages} page(s), ${res.cards} card(s) @${dpi}dpi`);
  }
}

main()
  .catch((err) => {
    console.error('[print] FATAL:', err instanceof Error ? err.stack : err);
    process.exitCode = 1;
  })
  .finally(() => void closePool());
