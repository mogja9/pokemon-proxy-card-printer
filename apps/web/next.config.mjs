/** @type {import('next').NextConfig} */
const nextConfig = {
  // workspace packages are shipped as TS source -> let Next transpile them
  transpilePackages: [
    '@proxyforge/config',
    '@proxyforge/db',
    '@proxyforge/print',
  ],
  // native / node-only deps must not be bundled
  serverExternalPackages: ['sharp', 'pg'],
  // allow remote card art (hotlink rows) in next/image, plus our own /img route
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'assets.tcgdex.net' },
      { protocol: 'https', hostname: 'images.pokemontcg.io' },
      { protocol: 'https', hostname: 'images.scrydex.com' },
    ],
  },
  eslint: { ignoreDuringBuilds: true },
  // workspace packages are authored as ESM TS with explicit .js import specifiers
  // (NodeNext). Let webpack resolve those .js specifiers to the .ts sources.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

export default nextConfig;
