'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { LAUNCH_LANGS } from '@proxyforge/config';
import { useCart } from '@/lib/cart';
import { buildExport, summarizeBySupertype, type ExportFormat } from '@/lib/printlist';
import { deckFileName } from '@/lib/filename';
import { loadRenderOptions, serializeRenderOptions } from '@/lib/renderOptions';
import { findDuplicateLines, summarizeDuplicates } from '@/lib/decklint';
import { sortPrintList, PRINT_SORTS, type PrintSort } from '@/lib/printsort';
import { clampQty, stepQty, QTY_MAX } from '@/lib/qty';

const RENDER_OPTS_KEY = 'pf.renderopts.v1';

// MakePlayingCards' largest single-order bracket. Mirrors @proxyforge/print
// MPC_MAX_ORDER, hardcoded because this client component cannot import the
// print package (it pulls sharp into the browser bundle). The server enforces
// the real value; this is only a pre-generate UI hint.
const MPC_MAX_ORDER = 612;

interface Unresolved {
  qty: number;
  name: string;
  reason: string;
}

export default function PrintPage() {
  const { items, addMany, setQty, remove, clear } = useCart();
  const [paper, setPaper] = useState('A4');
  const [dpi, setDpi] = useState('300');
  const [bleed, setBleed] = useState(false);
  const [gutter, setGutter] = useState('4');
  const [target, setTarget] = useState('pdf');
  const [deckName, setDeckName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [warn, setWarn] = useState('');
  const [deckText, setDeckText] = useState('');
  const [importLang, setImportLang] = useState('en');
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState('');
  const [dupNote, setDupNote] = useState('');
  const [unresolved, setUnresolved] = useState<Unresolved[]>([]);
  const [copied, setCopied] = useState(false);
  const [printSort, setPrintSort] = useState<PrintSort>('added');
  const [exportFormat, setExportFormat] = useState<ExportFormat>('grouped');

  // Restore the render options from a previous visit, then persist on change.
  // hydrated gates the save effect so the initial defaults never clobber the
  // stored values before the load effect has run.
  const hydrated = useRef(false);
  useEffect(() => {
    const o = loadRenderOptions(window.localStorage.getItem(RENDER_OPTS_KEY));
    setTarget(o.target);
    setPaper(o.paper);
    setDpi(o.dpi);
    setBleed(o.bleed);
    setGutter(o.gutter);
    setDeckName(o.deckName);
    hydrated.current = true;
  }, []);
  useEffect(() => {
    if (!hydrated.current) return;
    try {
      window.localStorage.setItem(
        RENDER_OPTS_KEY,
        serializeRenderOptions({ target: target as 'pdf' | 'mpc', paper: paper as 'A4' | 'letter', dpi: dpi as '300' | '600', bleed, gutter, deckName }),
      );
    } catch {
      /* storage full/unavailable: a non-persisted option is not worth crashing */
    }
  }, [target, paper, dpi, bleed, gutter, deckName]);

  const total = items.reduce((n, x) => n + x.qty, 0);
  const sheets = Math.ceil(total / 9); // 3x3 N-up
  // renderHomePdf switches Letter+bleed to A4, so label the paper actually used.
  const renderPaper = bleed && paper === 'letter' ? 'A4' : paper === 'letter' ? 'Letter' : 'A4';
  // MPC accepts at most MPC_MAX_ORDER cards per order; warn before generating.
  const mpcOverCapacity = target === 'mpc' && total > MPC_MAX_ORDER;
  // a name-based decklist of the current list (re-importable; round-trips with Import)
  const exportText = buildExport(items, exportFormat);
  // one-line breakdown by supertype, shown when the list spans more than one
  const summary = summarizeBySupertype(items);
  const multiType = summary.includes('·');

  async function copyDeck() {
    try {
      await navigator.clipboard.writeText(exportText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked (e.g. insecure context); the textarea is selectable */
    }
  }

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
      a.download = deckFileName(deckName, target === 'mpc' ? 'mpc' : 'pdf');
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

  async function importDeck() {
    setImporting(true);
    setImportMsg('');
    setDupNote('');
    setUnresolved([]);
    setErr('');
    // computed from the pasted text before it is cleared on success
    const dupNoteText = summarizeDuplicates(findDuplicateLines(deckText));
    try {
      const res = await fetch('/api/deck/resolve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: deckText, lang: importLang }),
      });
      if (!res.ok) throw new Error((await res.text()) || `import failed (${res.status})`);
      const data = (await res.json()) as {
        resolved: { qty: number; name: string; slug: string; lang: string; supertype: string | null }[];
        unresolved: Unresolved[];
      };
      addMany(
        data.resolved.map((r) => ({
          item: { slug: r.slug, lang: r.lang, name: r.name, imageUrl: null, supertype: r.supertype },
          qty: r.qty,
        })),
      );
      setUnresolved(data.unresolved);
      const added = data.resolved.reduce((n, r) => n + r.qty, 0);
      setImportMsg(
        `Added ${added} card${added === 1 ? '' : 's'} from ${data.resolved.length} line${
          data.resolved.length === 1 ? '' : 's'
        }.`,
      );
      if (data.resolved.length) {
        setDeckText('');
        setDupNote(dupNoteText);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  }

  return (
    <>
      <h1>Print list</h1>

      <details className="import" open={!items.length}>
        <summary>Import a decklist</summary>
        <p style={{ color: 'var(--muted)', fontSize: 12 }}>
          Paste a Pokémon TCG Live / Limitless decklist, e.g. <code>4 Pikachu SVI 94</code>.
          Trainer/Energy lines can be name-only.
        </p>
        <textarea
          value={deckText}
          onChange={(e) => setDeckText(e.target.value)}
          rows={8}
          placeholder={'Pokémon: 12\n4 Pikachu SVI 94\n2 Charizard ex OBF 125\n\nTrainer: 1\n3 Iono\n\nEnergy: 1\n8 Lightning Energy'}
          style={{ width: '100%', fontFamily: 'monospace', boxSizing: 'border-box' }}
        />
        <div className="optrow">
          <label>
            List language
            <select value={importLang} onChange={(e) => setImportLang(e.target.value)}>
              {LAUNCH_LANGS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <button className="primary" disabled={importing || !deckText.trim()} onClick={importDeck}>
            {importing ? 'Importing...' : 'Import to print list'}
          </button>
        </div>
        {importMsg && <p style={{ color: '#9ae89a' }}>{importMsg}</p>}
        {dupNote && <p style={{ color: 'var(--muted)', fontSize: 13 }}>{dupNote}</p>}
        {unresolved.length > 0 && (
          <div style={{ color: '#e8c06a', fontSize: 13 }}>
            <p>
              {unresolved.length} line{unresolved.length === 1 ? '' : 's'} could not be matched
              (add them manually from Browse):
            </p>
            <ul>
              {unresolved.map((u, i) => (
                <li key={i}>
                  {u.qty} x {u.name} - {u.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
      </details>

      {!items.length ? (
        <p style={{ color: 'var(--muted)' }}>
          Your print list is empty. Paste a decklist above, or <Link href="/">browse cards</Link>.
        </p>
      ) : (
        <>
      <p style={{ color: 'var(--muted)' }}>
        {total} card{total === 1 ? '' : 's'} · ~{sheets} {renderPaper} sheet
        {sheets === 1 ? '' : 's'} (3x3)
        {multiType && <> · {summary}</>}
      </p>
      {items.length > 1 && (
        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
          Sort
          <select value={printSort} onChange={(e) => setPrintSort(e.target.value as PrintSort)}>
            {PRINT_SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
      )}
      <table className="cart">
        <thead>
          <tr><th>Card</th><th>Lang</th><th>Qty</th><th></th></tr>
        </thead>
        <tbody>
          {sortPrintList(items, printSort).map((it) => (
            <tr key={`${it.slug}-${it.lang}`}>
              <td>
                <Link href={`/card/${it.slug}?lang=${it.lang}`}>{it.name}</Link>{' '}
                <span style={{ color: 'var(--muted)' }}>{it.slug}</span>
              </td>
              <td>{it.lang}</td>
              <td>
                <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                  <button
                    type="button"
                    className="ghost"
                    aria-label={`decrease quantity of ${it.name}`}
                    onClick={() => setQty(it.slug, it.lang, stepQty(it.qty, -1))}
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min={0}
                    max={QTY_MAX}
                    value={it.qty}
                    style={{ width: 64 }}
                    aria-label={`quantity of ${it.name}`}
                    onChange={(e) => setQty(it.slug, it.lang, clampQty(Number(e.target.value)))}
                  />
                  <button
                    type="button"
                    className="ghost"
                    aria-label={`increase quantity of ${it.name}`}
                    onClick={() => setQty(it.slug, it.lang, stepQty(it.qty, 1))}
                  >
                    +
                  </button>
                </span>
              </td>
              <td><button className="ghost" onClick={() => remove(it.slug, it.lang)}>remove</button></td>
            </tr>
          ))}
        </tbody>
      </table>

      <details className="export">
        <summary>Export this list</summary>
        <p style={{ color: 'var(--muted)', fontSize: 12 }}>
          A name-based decklist you can save, share, or re-import on another device (it
          round-trips with Import above).
        </p>
        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
          Format
          <select value={exportFormat} onChange={(e) => setExportFormat(e.target.value as ExportFormat)}>
            <option value="grouped">Grouped (Pokémon / Trainer / Energy)</option>
            <option value="plain">Plain (qty + name only)</option>
          </select>
        </label>
        <textarea
          readOnly
          value={exportText}
          rows={Math.min(12, Math.max(3, items.length))}
          style={{ width: '100%', fontFamily: 'monospace', boxSizing: 'border-box' }}
        />
        <button className="ghost" onClick={copyDeck}>
          {copied ? 'Copied ✓' : 'Copy to clipboard'}
        </button>
      </details>

      <div className="optrow">
        <label>Deck name
          <input
            type="text"
            value={deckName}
            placeholder="optional"
            maxLength={80}
            style={{ width: 160 }}
            onChange={(e) => setDeckName(e.target.value)}
          />
        </label>
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
        <button
          className="ghost"
          onClick={() => {
            if (window.confirm(`Clear all ${total} card${total === 1 ? '' : 's'} from the print list?`))
              clear();
          }}
        >
          Clear list
        </button>
      </div>
      {mpcOverCapacity && (
        <p style={{ color: '#e8c06a' }}>
          ⚠ {total} cards exceeds MakePlayingCards&rsquo; largest single order ({MPC_MAX_ORDER}). The
          ZIP still generates, but you&rsquo;ll need to split it into multiple MPC orders.
        </p>
      )}
      {warn && <p style={{ color: '#e8c06a' }}>⚠ {warn}</p>}
      <p style={{ color: 'var(--muted)', fontSize: 12 }}>
        Cards print at the fixed 63x88mm size. With a gutter, cut on the corner marks; bleed requires A4.
        {' '}Saves as <code>{deckFileName(deckName, target === 'mpc' ? 'mpc' : 'pdf')}</code>.
      </p>
        </>
      )}
      {err && <p style={{ color: '#ff9a9a' }}>{err}</p>}
    </>
  );
}
