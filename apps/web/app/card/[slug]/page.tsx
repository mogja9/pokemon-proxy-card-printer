import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LAUNCH_LANGS, type Lang } from '@proxyforge/config';
import { getCardBySlug } from '@/lib/db';
import AddToCart from '@/components/AddToCart';

export const dynamic = 'force-dynamic';

type SP = Record<string, string | string[] | undefined>;
const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const pickLang = (v: string | undefined): Lang =>
  (LAUNCH_LANGS as readonly string[]).includes(v ?? '') ? (v as Lang) : 'en';

export default async function CardPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SP>;
}) {
  const { slug } = await params;
  const lang = pickLang(str((await searchParams).lang));
  const detail = await getCardBySlug(slug, lang);
  if (!detail) notFound();
  const { card, localizations } = detail;
  const locByLang = new Map(localizations.map((l) => [l.lang, l]));

  return (
    <div className="detail">
      <div>
        <div className="art">
          {card.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={card.imageUrl} alt={card.name} />
          ) : (
            <span className="pill">no scan available</span>
          )}
        </div>
        <div className="badges" style={{ marginTop: 10 }}>
          {card.dpi != null && <span className="pill dpi">~{Math.round(card.dpi)} dpi</span>}
          {card.isEnFallback && <span className="pill fallback">English image (no {lang} scan)</span>}
        </div>
      </div>

      <div>
        <h1 style={{ margin: '0 0 4px' }}>{card.name}</h1>
        <p style={{ color: 'var(--muted)', marginTop: 0 }}>
          {card.setId} · {card.collector}
          {card.supertype ? ` · ${card.supertype}` : ''}
          {card.rarity ? ` · ${card.rarity}` : ''}
          {card.isPromo ? ' · promo' : ''}
        </p>

        <div className="langs">
          {LAUNCH_LANGS.map((l) => {
            const loc = locByLang.get(l);
            const cls = [l === lang ? 'active' : '', loc?.hasImage ? '' : 'noimg'].join(' ').trim();
            return (
              <Link key={l} className={cls} href={`/card/${slug}?lang=${l}`} title={loc ? loc.name : 'no localization'}>
                {l}
              </Link>
            );
          })}
        </div>
        <p style={{ color: 'var(--muted)', fontSize: 12 }}>
          Dimmed languages have no localized scan; the print falls back to the English image.
        </p>

        <div style={{ marginTop: 18 }}>
          <AddToCart slug={card.slug} lang={lang} name={card.name} imageUrl={card.imageUrl} />
        </div>

        <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 18 }}>
          Cards print at the fixed 63x88mm size. DPI shown is the source sharpness, not the size.
        </p>
      </div>
    </div>
  );
}
