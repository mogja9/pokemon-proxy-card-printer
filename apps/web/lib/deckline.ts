/**
 * Format a single PTCGL-style decklist line for a card, e.g. `1 Pikachu SVI 94`.
 * Framework-free and pure so the card page can render a copy button and the
 * logic stays unit-tested. The line round-trips through the decklist Import:
 * when a set code + number is present it resolves by (setCode, number); a
 * name-only line (no mapped set code) resolves by name.
 */

export interface DeckLineCard {
  name: string;
  setCode?: string | null; // PTCGL set code (card_set.ptcg_code), e.g. SVI
  collector?: string | null; // printed collector number, e.g. 94 / TG12
}

export function deckLineFor(card: DeckLineCard, qty = 1): string {
  const n = Number.isFinite(qty) ? Math.max(1, Math.floor(qty)) : 1;
  const code = card.setCode?.trim();
  const num = card.collector?.trim();
  const name = card.name.trim();
  if (code && num) return `${n} ${name} ${code.toUpperCase()} ${num}`;
  return `${n} ${name}`;
}
