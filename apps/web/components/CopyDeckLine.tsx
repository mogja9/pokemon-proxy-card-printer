'use client';
import { useState } from 'react';

// Copy a single decklist line (e.g. "1 Pikachu SVI 94") to the clipboard so it
// can be pasted into a decklist. The line is precomputed server-side via
// deckLineFor; this component only owns the copy interaction.
export default function CopyDeckLine({ line }: { line: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="ghost"
      title={`Copy "${line}" as a decklist line`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(line);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard blocked (e.g. insecure context); ignore */
        }
      }}
    >
      {copied ? 'Copied ✓' : 'Copy decklist line'}
    </button>
  );
}
