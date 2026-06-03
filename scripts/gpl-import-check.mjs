#!/usr/bin/env node
/**
 * gpl-import-check: fail if any source file imports/references GPL-3 code that
 * must stay isolated (mpc-autofill / chilli-axe). The MPC order.xml format is to
 * be CLEAN-ROOM reimplemented in its own module - never vendored. (Architecture
 * sec.6/sec.10: GPL-3 isolation.)
 */
import { readFile, readdir } from 'node:fs/promises';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FORBIDDEN = [/mpc-autofill/i, /chilli-axe/i];
const SCAN_EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json']);
const SKIP_DIR = new Set(['node_modules', 'dist', '.git']);

const hits = [];

async function walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIR.has(e.name)) await walk(resolve(dir, e.name));
      continue;
    }
    if (!SCAN_EXT.has(extname(e.name))) continue;
    const path = resolve(dir, e.name);
    // don't flag this checker file itself
    if (path === fileURLToPath(import.meta.url)) continue;
    const text = await readFile(path, 'utf8');
    for (const re of FORBIDDEN) {
      if (re.test(text)) hits.push(`${path}: matches ${re}`);
    }
  }
}

await walk(ROOT);

if (hits.length) {
  console.error('gpl-import-check FAILED (GPL-3 isolation breach):\n - ' + hits.join('\n - '));
  process.exit(1);
}
console.log('gpl-import-check OK: no GPL-3 (mpc-autofill) references in source');
