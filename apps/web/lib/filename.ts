/**
 * Build the download filename for a rendered print job. An optional user deck
 * name is slugified to a filesystem-safe base; empty/blank names fall back to
 * "proxies". Pure + unit-tested so the print page can name exports without
 * risking odd characters in the Content-Disposition / browser download.
 */

// Unicode combining marks left behind after NFKD decomposition (Café -> Cafe).
const DIACRITICS = /[̀-ͯ]/g;

/** Slugify a deck name to a safe filename base (no extension). '' -> 'proxies'. */
export function slugifyDeckName(name: string): string {
  const s = name
    .normalize('NFKD')
    .replace(DIACRITICS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // any run of non-alphanumerics -> single dash
    .replace(/^-+|-+$/g, '') // trim leading/trailing dashes
    .slice(0, 60);
  return s.replace(/-+$/g, '') || 'proxies'; // re-trim if slice landed on a dash
}

/** Download filename for a target: `<base>.pdf` for PDF, `<base>-mpc.zip` for MPC. */
export function deckFileName(name: string, target: 'pdf' | 'mpc'): string {
  const base = slugifyDeckName(name);
  return target === 'mpc' ? `${base}-mpc.zip` : `${base}.pdf`;
}

/** Filename for the exported decklist text: `<base>.txt`. */
export function deckTextFileName(name: string): string {
  return `${slugifyDeckName(name)}.txt`;
}
