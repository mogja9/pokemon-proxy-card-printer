'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useCart } from '@/lib/cart';

export default function PrintPage() {
  const { items, setQty, remove, clear } = useCart();
  const [paper, setPaper] = useState('A4');
  const [dpi, setDpi] = useState('300');
  const [bleed, setBleed] = useState(false);
  const [gutter, setGutter] = useState('4');
  const [target, setTarget] = useState('pdf');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [warn, setWarn] = useState('');

  const total = items.reduce((n, x) => n + x.qty, 0);
  const sheets = Math.ceil(total / 9);

  async function generate() {
    setBusy(true);
    setErr('');
    setWarn('');
    try {
      const res = await fetch('/api/render', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          items: items.map((i) => ({ slug: i.slug, lang: i.lang, qty: i.qty })),
          target,
          paper,
          dpi: Number(dpi),
          bleed,
          gutter: Number(gutter),
        }),
      });
      if (!res.ok) throw new Error((await res.text()) || `render failed (${res.status})`);
      const w = res.headers.get('x-render-warnings');
      if (w) setWarn(decodeURIComponent(w));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = target === 'mpc' ? 'proxies-mpc.zip' : 'proxies.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!items.length) {
    return (
      <p>
        Your print list is empty. <Link href="/">Browse cards</Link> and add some.
      </p>
    );
  }

  return (
    <>
      <h1>Print list</h1>
      <p style={{ color: 'var(--muted)' }}>
        {total} card{total === 1 ? '' : 's'} · ~{sheets} A4 sheet{sheets === 1 ? '' : 's'} (3x3)
      </p>
      <table className="cart">
        <thead>
          <tr><th>Card</th><th>Lang</th><th>Qty</th><th></th></tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={`${it.slug}-${it.lang}`}>
              <td>
                <Link href={`/card/${it.slug}?lang=${it.lang}`}>{it.name}</Link>{' '}
                <span style={{ color: 'var(--muted)' }}>{it.slug}</span>
              </td>
              <td>{it.lang}</td>
              <td>
                <input
                  type="number"
                  min={1}
                  max={999}
                  value={it.qty}
                  style={{ width: 64 }}
                  onChange={(e) => setQty(it.slug, it.lang, Math.max(0, Number(e.target.value) || 0))}
                />
              </td>
              <td><button className="ghost" onClick={() => remove(it.slug, it.lang)}>remove</button></td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="optrow">
        <label>Output
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="pdf">Home PDF (3x3)</option>
            <option value="mpc">MakePlayingCards ZIP</option>
          </select>
        </label>
        {target === 'pdf' && (
          <>
            <label>Paper
              <select value={paper} onChange={(e) => setPaper(e.target.value)}>
                <option value="A4">A4</option>
                <option value="letter">US Letter</option>
              </select>
            </label>
            <label>Gutter (mm)
              <input type="number" min={0} max={20} value={gutter} style={{ width: 70 }}
                onChange={(e) => setGutter(e.target.value)} />
            </label>
            <label>Bleed
              <input type="checkbox" checked={bleed} onChange={(e) => setBleed(e.target.checked)} />
            </label>
          </>
        )}
        <label>DPI
          <select value={dpi} onChange={(e) => setDpi(e.target.value)}>
            <option value="300">300</option>
            <option value="600">600</option>
          </select>
        </label>
        <button className="primary" disabled={busy} onClick={generate}>
          {busy ? 'Generating...' : 'Generate'}
        </button>
        <button className="ghost" onClick={clear}>Clear list</button>
      </div>
      {err && <p style={{ color: '#ff9a9a' }}>{err}</p>}
      {warn && <p style={{ color: '#e8c06a' }}>⚠ {warn}</p>}
      <p style={{ color: 'var(--muted)', fontSize: 12 }}>
        Cards print at the fixed 63x88mm size. With a gutter, cut on the corner marks; bleed requires A4.
      </p>
    </>
  );
}
