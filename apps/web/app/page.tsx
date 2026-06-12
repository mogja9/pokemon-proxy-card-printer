import Link from 'next/link';
import { LAUNCH_LANGS, type Lang } from '@proxyforge/config';
import { listSets, listSupertypes, type BrowseSort } from '@/lib/db';
import { searchCards } from '@/lib/search';
import CardCard from '@/components/CardCard';
import PageJump from '@/components/PageJump';
import { emptyStateSuggestions } from '@/lib/emptystate';
import { pageRange, formatPageRange } from '@/lib/pagerange';

export const dynamic = 'force-dynamic';

type SP = Record<string, string | string[] | undefined>;
const str = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;

function pickLang(v: string | undefined): Lang {
  return (LAUNCH_LANGS as readonly string[]).includes(v ?? '') ? (v as Lang) : 'en';
}

const SORTS: { value: BrowseSort; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'set', label: 'By set' },
];
function pickSort(v: string | undefined): BrowseSort {
  return SORTS.some((s) => s.value === v) ? (v as BrowseSort) : 'newest';
}

const PAGE_SIZES = [24, 48, 96] as const;
const DEFAULT_PAGE_SIZE = 48;
function pickPageSize(v: string | undefined): number {
  const n = Number(v);
  return (PAGE_SIZES as readonly number[]).includes(n) ? n : DEFAULT_PAGE_SIZE;
}

export default async function Browse({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const lang = pickLang(str(sp.lang));
  const q = str(sp.q);
  const set = str(sp.set);
  const supertype = str(sp.supertype);
  const promoOnly = str(sp.promo) === '1';
  const sort = pickSort(str(sp.sort));
  const pageSize = pickPageSize(str(sp.size));
  const page = Math.max(1, Number(str(sp.page) ?? '1') || 1);

  let res, sets, types, err: string | null = null;
  try {
    [res, sets, types] = await Promise.all([
      searchCards({ lang, ...(q ? { q } : {}), ...(set ? { set } : {}), ...(supertype ? { supertype } : {}), promoOnly, sort, page, pageSize }),
      listSets(),
      listSupertypes(),
    ]);
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }

  // Any narrowing filter active (language is a preference, not a filter, so a
  // clear keeps it). Drives the "Clear" link next to the Filter button.
  const hasFilters = Boolean(
    q || set || supertype || promoOnly || sort !== 'newest' || pageSize !== DEFAULT_PAGE_SIZE,
  );
  const clearHref = lang !== 'en' ? `/?lang=${lang}` : '/';

  const totalPages = res ? Math.max(1, Math.ceil(res.total / res.pageSize)) : 1;
  const qs = (over: Record<string, string>) => {
    const p = new URLSearchParams();
    if (lang !== 'en') p.set('lang', lang);
    if (q) p.set('q', q);
    if (set) p.set('set', set);
    if (supertype) p.set('supertype', supertype);
    if (promoOnly) p.set('promo', '1');
    if (sort !== 'newest') p.set('sort', sort);
    if (pageSize !== DEFAULT_PAGE_SIZE) p.set('size', String(pageSize));
    for (const [k, v] of Object.entries(over)) v ? p.set(k, v) : p.delete(k);
    return `/?${p.toString()}`;
  };

  return (
    <>
      <form className="filters" method="get">
        <label>Search<input name="q" defaultValue={q ?? ''} placeholder="card name" /></label>
        <label>Language
          <select name="lang" defaultValue={lang}>
            {LAUNCH_LANGS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>
        <label>Set
          <select name="set" defaultValue={set ?? ''}>
            <option value="">All sets</option>
            {(sets ?? []).map((s) => <option key={s.setId} value={s.setId}>{s.name} ({s.setId})</option>)}
          </select>
        </label>
        <label>Type
          <select name="supertype" defaultValue={supertype ?? ''}>
            <option value="">All types</option>
            {(types ?? []).map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label>Promo<input type="checkbox" name="promo" value="1" defaultChecked={promoOnly} /></label>
        <label>Sort
          <select name="sort" defaultValue={sort}>
            {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        <label>Per page
          <select name="size" defaultValue={String(pageSize)}>
            {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <button type="submit">Filter</button>
        {hasFilters && <Link className="ghost" href={clearHref}>Clear</Link>}
      </form>

      {err && <p style={{ color: '#ff9a9a' }}>Database not reachable: {err}. Run the ingest first.</p>}

      {res && (
        <>
          <p style={{ color: 'var(--muted)' }}>{formatPageRange(pageRange(page, res.pageSize, res.total))}</p>
          <div className="grid">
            {res.cards.map((c) => <CardCard key={c.id} card={c} />)}
          </div>
          {res.cards.length === 0 && (
            <div style={{ color: 'var(--muted)' }}>
              <p style={{ marginBottom: 4 }}>No cards match.</p>
              <ul style={{ margin: '0 0 8px', paddingLeft: 18 }}>
                {emptyStateSuggestions({ q, set, supertype, promoOnly, lang }).map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
              {hasFilters && <Link className="ghost" href={clearHref}>Clear all filters</Link>}
            </div>
          )}
          <div className="pager">
            {page > 1 && <Link className="ghost" href={qs({ page: String(page - 1) })}>Prev</Link>}
            <span style={{ color: 'var(--muted)' }}>Page {page} / {totalPages}</span>
            {page < totalPages && <Link className="ghost" href={qs({ page: String(page + 1) })}>Next</Link>}
            {totalPages > 1 && <PageJump current={page} totalPages={totalPages} />}
          </div>
        </>
      )}
    </>
  );
}
