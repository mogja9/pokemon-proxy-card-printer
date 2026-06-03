/**
 * Image preparation (the reusable Phase-2 core). Resize source art to the fixed
 * trim box, flatten transparent rounded corners onto the sampled border colour
 * (so the printed card is a full rectangle), and synthesize bleed - no source
 * ships bleed. Uses sharp (libvips); all FOSS.
 */
import sharp from 'sharp';
import { trimPx, homeBleedPx, mpcBleedPx, type BleedPx } from './geometry.js';

export type PrintMode = 'home-trim' | 'home-bleed' | 'mpc';
export type BleedStyle = 'edge' | 'mirror';

export interface PreparedImage {
  png: Buffer;
  widthPx: number;
  heightPx: number;
}

/** Sample the card's border colour from a thin strip along the top edge. */
async function sampleBorderColor(buf: Buffer): Promise<{ r: number; g: number; b: number }> {
  const meta = await sharp(buf).metadata();
  const w = meta.width ?? 1;
  const h = meta.height ?? 1;
  const stripH = Math.max(2, Math.round(h * 0.03));
  const px = await sharp(buf)
    .extract({ left: 0, top: 0, width: w, height: stripH })
    .resize(1, 1, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer();
  return { r: px[0] ?? 255, g: px[1] ?? 255, b: px[2] ?? 255 };
}

export interface PrepareOptions {
  dpi: number;
  mode: PrintMode;
  inkSaver?: boolean;
  bleedStyle?: BleedStyle;
}

export async function prepareCardImage(
  input: Buffer,
  opts: PrepareOptions,
): Promise<PreparedImage> {
  const t = trimPx(opts.dpi);

  // 1. resize to the fixed trim box (fill; aspect ~63:88 so distortion < 0.2%)
  const trimmed = await sharp(input, { failOn: 'none' })
    .ensureAlpha()
    .resize(t.w, t.h, { fit: 'fill', kernel: 'lanczos3' })
    .png()
    .toBuffer();

  // 2. flatten transparent corners onto the sampled border colour (full rectangle)
  const border = await sampleBorderColor(trimmed);
  let pipe = sharp(trimmed).flatten({ background: border });
  if (opts.inkSaver) pipe = pipe.grayscale();

  if (opts.mode === 'home-trim') {
    const png = await pipe.png().toBuffer();
    return { png, widthPx: t.w, heightPx: t.h };
  }

  // 3. synthesize bleed by replicating ('edge') or mirroring the outer pixels
  const bleed: BleedPx = opts.mode === 'mpc' ? mpcBleedPx(opts.dpi) : homeBleedPx(opts.dpi);
  const extendWith = opts.bleedStyle === 'mirror' ? 'mirror' : 'copy';
  const png = await pipe
    .extend({ top: bleed.top, bottom: bleed.bottom, left: bleed.left, right: bleed.right, extendWith })
    .png()
    .toBuffer();
  const meta = await sharp(png).metadata();
  return { png, widthPx: meta.width ?? t.w + bleed.left + bleed.right, heightPx: meta.height ?? t.h + bleed.top + bleed.bottom };
}
