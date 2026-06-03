'use client';
import { useCart } from '@/lib/cart';

export default function CartCount() {
  const { count } = useCart();
  return <span>Print list{count > 0 ? ` (${count})` : ''}</span>;
}
