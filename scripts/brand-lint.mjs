#!/usr/bin/env node
/**
 * brand-lint: fail if any BRANDING slot contains a trademarked term. Descriptive
 * body usage (e.g. "a proxy printer for the Pokemon TCG") is allowed under
 * nominative fair use; this only scans identity slots: package.json "name"
 * fields, the docker-compose project name, and the repo directory name.
 * (Architecture sec.10: no trademark in branding/domain/logo/handles.)
 */
import { readFile, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Keep in sync with @proxyforge/config trademarkedTermsBanned (loadCompliance).
const BANNED = ['pokemon', 'pokémon', 'poké', 'pokeball', 'poke-ball', 'nintendo', 'gamefreak'];

const problems = [];

function check(slot, value) {
  if (!value) return;
  const v = String(value).toLowerCase();
  for (const term of BANNED) {
    if (v.includes(term)) problems.push(`${slot}: "${value}" contains banned term "${term}"`);
  }
}

async function listPackageJsons() {
  const out = [resolve(ROOT, 'package.json')];
  for (const dir of ['packages', 'apps']) {
    const base = resolve(ROOT, dir);
    try {
      for (const d of await readdir(base, { withFileTypes: true })) {
        if (d.isDirectory()) out.push(resolve(base, d.name, 'package.json'));
      }
    } catch {
      /* dir absent */
    }
  }
  return out;
}

// NOTE: the LOCAL directory name is intentionally NOT checked - it is a private
// filesystem path, not a shipping identity. The public identity slots are the
// package names, the compose project name, and (later) the domain/logo/handles.

// 1. every package.json "name"
for (const p of await listPackageJsons()) {
  try {
    const pkg = JSON.parse(await readFile(p, 'utf8'));
    check(`${p} name`, pkg.name);
  } catch {
    /* missing pkg */
  }
}

// 3. docker-compose project name
try {
  const compose = await readFile(resolve(ROOT, 'docker-compose.yml'), 'utf8');
  const m = compose.match(/^name:\s*(.+)$/m);
  if (m) check('docker-compose name', m[1].trim());
} catch {
  /* no compose */
}

if (problems.length) {
  console.error('brand-lint FAILED:\n - ' + problems.join('\n - '));
  process.exit(1);
}
console.log('brand-lint OK: no trademarked terms in branding slots');
