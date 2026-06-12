'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { clampPage } from '@/lib/pagejump';

// Jump straight to a page in the browse pager. Preserves every other query
// param by mutating the current URLSearchParams; clampPage keeps the target in
// range so a typo can never land on an empty result set.
export default function PageJump({ current, totalPages }: { current: number; totalPages: number }) {
  const router = useRouter();
  const params = useSearchParams();
  const [val, setVal] = useState(String(current));

  function go() {
    const next = clampPage(val, totalPages);
    const p = new URLSearchParams(params?.toString() ?? '');
    if (next === 1) p.delete('page');
    else p.set('page', String(next));
    const qs = p.toString();
    router.push(qs ? `/?${qs}` : '/');
  }

  return (
    <form
      style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}
      onSubmit={(e) => {
        e.preventDefault();
        go();
      }}
    >
      <label style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
        Go to
        <input
          type="number"
          min={1}
          max={totalPages}
          value={val}
          aria-label="page number"
          style={{ width: 64 }}
          onChange={(e) => setVal(e.target.value)}
        />
      </label>
      <button type="submit" className="ghost">Go</button>
    </form>
  );
}
