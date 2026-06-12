'use client';
import { useCallback, useEffect, useState } from 'react';

export interface CartItem {
  slug: string;
  lang: string;
  name: string;
  imageUrl: string | null;
  qty: number;
  supertype?: string | null; // Pokemon | Trainer | Energy (for grouped export)
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
  try {
    window.localStorage.setItem(KEY, JSON.stringify(items));
  } catch (err) {
    // localStorage full (~5MB cap) or unavailable (private mode): never crash
    // the UI over a persistence failure. The event still fires so listeners
    // re-read the last persisted state.
    console.warn('[cart] could not persist print list:', err);
  }
  window.dispatchEvent(new Event(EVT));
}

// Exported for unit testing: the load-bearing dedup the decklist import relies
// on (same slug+lang merges and sums qty; a different lang is a separate row).
// Pure - mutates the passed array, no IO.
export function mergeInto(cur: CartItem[], it: Omit<CartItem, 'qty'>, qty: number): void {
  const i = cur.findIndex((x) => x.slug === it.slug && x.lang === it.lang);
  if (i >= 0) cur[i]!.qty += qty;
  else cur.push({ ...it, qty });
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
    mergeInto(cur, it, qty);
    write(cur);
  }, []);

  // bulk add (e.g. decklist import): ONE read + ONE write + ONE change event
  // for the whole batch, not one per card - avoids an O(n^2) localStorage
  // re-serialize + a render storm when importing a 60-card deck.
  const addMany = useCallback((entries: { item: Omit<CartItem, 'qty'>; qty: number }[]) => {
    if (!entries.length) return;
    const cur = read();
    for (const { item, qty } of entries) mergeInto(cur, item, qty);
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
  return { items, count, add, addMany, setQty, remove, clear };
}
