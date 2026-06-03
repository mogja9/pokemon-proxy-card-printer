import Link from 'next/link';
import { LAUNCH_LANGS, type Lang } from '@proxyforge/config';
import { searchCards, listSets, listSupertypes } from '@/lib/db';
import CardCard from '@/components/CardCard';

export const dynamic = 'force-dynamic';

type SP = Record<string, string | string[] | undefined>;
const str = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;

function pickLang(v: string | undefined): Lang {
  return (LAUNCH_LANGS as readonly string[]).includes(v ?? '') ? (v as Lang) : 'en';
}

export default async function Browse({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const lang = pickLang(str(sp.lang));
  const q = str(sp.q);
  const set = str(sp.set);
  const supertype = str(sp.supertype);
  const promoOnly = str(sp.promo) === '1';
  const page = Math.max(1, Number(str(sp.page) ?? '1') || 1);

  let res, sets, types, err: string | null = null;
  try {
    [res, sets, types] = await Promise.all([
      searchCards({ lang, ...(q ? { q } : {}), ...(set ? { set } : {}), ...(supertype ? { supertype } : {}), promoOnly, page }),
      listSets(),
      listSupertypes(),
    ]);
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }

  const totalPages = res ? Math.max(1, Math.ceil(res.total / res.pageSize)) : 1;
  const qs = (over: Record<string, string>) => {
    const p = new URLSearchParams();
    if (lang !== 'en') p.set('lang', lang);
    if (q) p.set('q', q);
    if (set) p.set('set', set);
    if (supertype) p.set('supertype', supertype);
    if (promoOnly) p.set('promo', '1');
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
        <button type="submit">Filter</button>
      </form>

      {err && <p style={{ color: '#ff9a9a' }}>Database not reachable: {err}. Run the ingest first.</p>}

      {res && (
        <>
          <p style={{ color: 'var(--muted)' }}>{res.total.toLocaleString()} cards</p>
          <div className="grid">
            {res.cards.map((c) => <CardCard key={c.id} card={c} />)}
          </div>
          {res.cards.length === 0 && <p>No cards match. Try another language or clear filters.</p>}
          <div className="pager">
            {page > 1 && <Link className="ghost" href={qs({ page: String(page - 1) })}>Prev</Link>}
            <span style={{ color: 'var(--muted)' }}>Page {page} / {totalPages}</span>
            {page < totalPages && <Link className="ghost" href={qs({ page: String(page + 1) })}>Next</Link>}
          </div>
        </>
      )}
    </>
  );
}
