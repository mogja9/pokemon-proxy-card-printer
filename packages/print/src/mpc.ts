/**
 * Mode B - MakePlayingCards (MPC) export. Emits one 822x1122 (@300) PNG per card
 * with synthesized asymmetric bleed + an order.xml manifest, zipped.
 *
 * The order.xml is a CLEAN-ROOM reimplementation of the public MPC autofill file
 * format (a file format is not copyrightable). NO GPL-3 code is used or vendored;
 * the CI gpl-import-check enforces this.
 */
import { zipSync, strToU8 } from 'fflate';
import { mpcCanvasPx, type Dpi } from './geometry.js';
import { prepareCardImage } from './prepare.js';
import type { PrintItem } from './homepdf.js';

/**
 * MPC "Game Cards 63x88mm" quantity ladder. KNOWN FOOTGUN: it overshoots some
 * orders (240 -> 396) and MPC periodically adds tiers. Smallest-bracket->=qty is
 * correct; VERIFY the values against the live MPC product before launch (sec.8.6).
 */
export const MPC_BRACKETS = [
  18, 36, 55, 72, 90, 108, 126, 144, 162, 180, 198, 216, 234, 396, 504, 612,
] as const;

export function mpcBracket(qty: number): number {
  for (const b of MPC_BRACKETS) if (qty <= b) return b;
  return MPC_BRACKETS[MPC_BRACKETS.length - 1]!;
}

function sanitize(label: string | undefined): string {
  return (label ?? 'card').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 60);
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface MpcOptions {
  dpi: Dpi;
  /** generic/marked back only; the official back is never used (sec.10). */
  backPng?: Buffer;
  stock?: string;
}

export interface MpcResult {
  zip: Uint8Array;
  bracket: number;
  totalCards: number;
  canvasPx: { w: number; h: number };
}

export async function renderMpcZip(items: PrintItem[], opts: MpcOptions): Promise<MpcResult> {
  const files: Record<string, Uint8Array> = {};
  const cardXml: string[] = [];
  let slot = 0;

  for (const it of items) {
    const prepared = await prepareCardImage(it.image, { dpi: opts.dpi, mode: 'mpc' });
    const name = `fronts/${String(slot).padStart(3, '0')}_${sanitize(it.label)}.png`;
    files[name] = new Uint8Array(prepared.png);
    const slots: number[] = [];
    for (let i = 0; i < it.quantity; i++) slots.push(slot + i);
    slot += it.quantity;
    cardXml.push(
      `    <card>\n` +
        `      <id>local:${xmlEscape(name)}</id>\n` +
        `      <slots>${slots.join(',')}</slots>\n` +
        `      <name>${xmlEscape(name.replace('fronts/', ''))}</name>\n` +
        `      <query>${xmlEscape(it.label ?? 'card')}</query>\n` +
        `    </card>`,
    );
  }

  const total = slot;
  const bracket = mpcBracket(total);
  const stock = opts.stock ?? '(S30) Standard Smooth';

  let backTag = '';
  if (opts.backPng) {
    files['backs/proxy_back.png'] = new Uint8Array(opts.backPng);
    backTag = `  <cardback>local:backs/proxy_back.png</cardback>\n`;
  }

  const orderXml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<order>\n` +
    `  <details>\n` +
    `    <quantity>${total}</quantity>\n` +
    `    <bracket>${bracket}</bracket>\n` +
    `    <stock>${xmlEscape(stock)}</stock>\n` +
    `    <foil>false</foil>\n` +
    `  </details>\n` +
    `  <fronts>\n${cardXml.join('\n')}\n  </fronts>\n` +
    backTag +
    `</order>\n`;
  files['order.xml'] = strToU8(orderXml);

  files['README.txt'] = strToU8(
    'Unofficial proxies for personal, non-commercial playtesting only. NOT ' +
      'tournament-legal; do not sell or pass off as genuine. Card art/text are ' +
      'copyright their respective owners.\n',
  );

  return { zip: zipSync(files, { level: 6 }), bracket, totalCards: total, canvasPx: mpcCanvasPx(opts.dpi) };
}
