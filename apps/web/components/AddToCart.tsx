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
  const [added, setAdded] = useState(false);
  return (
    <button
      className="primary"
      onClick={() => {
        add({ slug: props.slug, lang: props.lang, name: props.name, imageUrl: props.imageUrl });
        setAdded(true);
        setTimeout(() => setAdded(false), 1200);
      }}
    >
      {added ? 'Added ✓' : 'Add to print list'}
    </button>
  );
}
