'use client';
import { useState } from 'react';
import { useCart } from '@/lib/cart';

export default function AddToCart(props: {
  slug: string;
  lang: string;
  name: string;
  imageUrl: string | null;
}) {
  const { add } = useCart();
  const [added, setAdded] = useState(0);
  const [qty, setQty] = useState(1);
  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
      <input
        type="number"
        min={1}
        max={99}
        value={qty}
        aria-label="quantity"
        style={{ width: 56 }}
        onChange={(e) => setQty(Math.max(1, Math.min(99, Number(e.target.value) || 1)))}
      />
      <button
        className="primary"
        onClick={() => {
          add(
            { slug: props.slug, lang: props.lang, name: props.name, imageUrl: props.imageUrl },
            qty,
          );
          setAdded(qty);
          setTimeout(() => setAdded(0), 1400);
        }}
      >
        {added ? `Added ${added} ✓` : 'Add to print list'}
      </button>
    </span>
  );
}
