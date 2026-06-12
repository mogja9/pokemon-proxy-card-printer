/**
 * Context-aware suggestions for the browse empty state. Given the active
 * filters, return concrete next steps (loosen the narrowest filters first).
 * When nothing is filtered, an empty result means the catalog itself is empty,
 * so suggest running the ingest. Pure + unit-tested.
 */

export interface BrowseFilterState {
  q?: string;
  set?: string;
  supertype?: string;
  promoOnly?: boolean;
  lang?: string;
}

export function emptyStateSuggestions(f: BrowseFilterState): string[] {
  const s: string[] = [];
  if (f.q) s.push(`Check the spelling of "${f.q}", or try a shorter or partial name.`);
  if (f.set) s.push('Remove the set filter - this set may not have scans in this language yet.');
  if (f.supertype) s.push(`Remove the ${f.supertype} type filter.`);
  if (f.promoOnly) s.push('Uncheck Promo to include regular cards.');
  if (f.lang && f.lang !== 'en') s.push('Switch the language to English, which has the most scans.');
  if (!s.length) s.push('No cards are loaded yet - run the ingest to populate the catalog.');
  return s;
}
