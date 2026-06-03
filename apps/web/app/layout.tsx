import './globals.css';
import type { ReactNode } from 'react';
import Link from 'next/link';
import CartCount from '@/components/CartCount';

export const metadata = {
  title: 'ProxyForge - TCG proxy printer',
  description: 'Free, fan-made tool to find cards and print playtest proxies at the fixed competitive size.',
  robots: { index: false, follow: false }, // low profile (compliance)
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site">
          <Link href="/" className="brand">ProxyForge</Link>
          <nav>
            <Link href="/">Browse</Link>
            <Link href="/print"><CartCount /></Link>
          </nav>
        </header>
        <main>{children}</main>
        <footer className="disclaimer">
          Unofficial, non-commercial fan tool. Not affiliated with, endorsed by, or sponsored by
          Nintendo, The Pokemon Company, Game Freak, or Creatures Inc. All card images and text are
          copyright their respective owners, shown for identification and reference only. Proxies are
          for personal playtesting and casual use; they are NOT tournament-legal and may not be sold
          or passed off as genuine.
        </footer>
      </body>
    </html>
  );
}
