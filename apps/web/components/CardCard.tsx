import Link from 'next/link';
import type { CardRow } from '@/lib/db';

export default function CardCard({ card }: { card: CardRow }) {
  return (
    <Link className="card" href={`/card/${card.slug}?lang=${card.lang}`}>
      <div className="thumb">
        {card.imageUrl ? (
          // plain img: same-origin /img route + remote hotlinks; lazy-loaded thumbnails
          // eslint-disable-next-line @next/next/no-img-element
          <img src={card.imageUrl} alt={card.name} loading="lazy" />
        ) : (
          <span className="pill">no scan</span>
        )}
      </div>
      <div className="meta">
        <div className="name">{card.name}</div>
        <div className="sub">
          {card.setId} · {card.collector}
          {card.rarity ? ` · ${card.rarity}` : ''}
        </div>
        <div className="badges">
          {card.dpi != null && <span className="pill dpi">~{Math.round(card.dpi)} dpi</span>}
          {card.isEnFallback && <span className="pill fallback">EN image</span>}
          {card.isPromo && <span className="pill promo">promo</span>}
        </div>
      </div>
    </Link>
  );
}
