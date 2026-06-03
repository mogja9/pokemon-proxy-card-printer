'use client';
import { useCallback, useEffect, useState } from 'react';

export interface CartItem {
  slug: string;
  lang: string;
  name: string;
  imageUrl: string | null;
  qty: number;
}

const KEY = 'pf.printlist.v1';
const EVT = 'pf-cart-change';

function read(): CartItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as CartItem[]) : [];
  } catch {
    return [];
  }
}

function write(items: CartItem[]): void {
  window.localStorage.setItem(KEY, JSON.stringify(items));
  window.dispatchEvent(new Event(EVT));
}

export function useCart() {
  const [items, setItems] = useState<CartItem[]>([]);
  useEffect(() => {
    setItems(read());
    const h = () => setItems(read());
    window.addEventListener(EVT, h);
    window.addEventListener('storage', h);
    return () => {
      window.removeEventListener(EVT, h);
      window.removeEventListener('storage', h);
    };
  }, []);

  const add = useCallback((it: Omit<CartItem, 'qty'>, qty = 1) => {
    const cur = read();
    const i = cur.findIndex((x) => x.slug === it.slug && x.lang === it.lang);
    if (i >= 0) cur[i]!.qty += qty;
    else cur.push({ ...it, qty });
    write(cur);
  }, []);

  const setQty = useCallback((slug: string, lang: string, qty: number) => {
    const cur = read()
      .map((x) => (x.slug === slug && x.lang === lang ? { ...x, qty } : x))
      .filter((x) => x.qty > 0);
    write(cur);
  }, []);

  const remove = useCallback((slug: string, lang: string) => {
    write(read().filter((x) => !(x.slug === slug && x.lang === lang)));
  }, []);

  const clear = useCallback(() => write([]), []);

  const count = items.reduce((n, x) => n + x.qty, 0);
  return { items, count, add, setQty, remove, clear };
}
