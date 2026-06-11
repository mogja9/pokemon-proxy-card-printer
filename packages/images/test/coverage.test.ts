import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  coveragePct,
  sumRows,
  rollupByLang,
  formatCoverageTable,
  type CoverageRow,
} from '../src/coverage.js';

const row = (p: Partial<CoverageRow>): CoverageRow => ({
  setId: 'sv1',
  lang: 'en',
  eligible: 0,
  anyImage: 0,
  native: 0,
  enFallback: 0,
  missing: 0,
  ...p,
});

test('coveragePct: any-image over eligible, one decimal', () => {
  assert.equal(coveragePct({ eligible: 200, anyImage: 144 }), 72);
  assert.equal(coveragePct({ eligible: 3, anyImage: 1 }), 33.3);
  assert.equal(coveragePct({ eligible: 0, anyImage: 0 }), 0); // no divide-by-zero
});

test('sumRows: aggregates every count and relabels set', () => {
  const out = sumRows('(all sets)', 'en', [
    row({ setId: 'sv1', eligible: 10, anyImage: 8, native: 7, enFallback: 1, missing: 2 }),
    row({ setId: 'sv2', eligible: 5, anyImage: 5, native: 5, enFallback: 0, missing: 0 }),
  ]);
  assert.deepEqual(out, {
    setId: '(all sets)',
    lang: 'en',
    eligible: 15,
    anyImage: 13,
    native: 12,
    enFallback: 1,
    missing: 2,
  });
});

test('rollupByLang: one total per language, lang-sorted', () => {
  const rows = [
    row({ setId: 'sv1', lang: 'ja', eligible: 10, anyImage: 4, missing: 6 }),
    row({ setId: 'sv2', lang: 'ja', eligible: 10, anyImage: 6, missing: 4 }),
    row({ setId: 'sv1', lang: 'en', eligible: 10, anyImage: 10, native: 10 }),
  ];
  const out = rollupByLang(rows);
  assert.deepEqual(out.map((r) => r.lang), ['en', 'ja']); // sorted
  const ja = out.find((r) => r.lang === 'ja')!;
  assert.equal(ja.eligible, 20);
  assert.equal(ja.anyImage, 10);
  assert.equal(ja.missing, 10);
  assert.equal(coveragePct(ja), 50);
});

test('formatCoverageTable: header + aligned columns, cov% rendered', () => {
  const out = formatCoverageTable([
    row({ setId: 'sv1', lang: 'en', eligible: 200, anyImage: 200, native: 200 }),
    row({ setId: 'sv1', lang: 'ja', eligible: 200, anyImage: 144, native: 100, enFallback: 44, missing: 56 }),
  ]);
  const lines = out.split('\n');
  assert.match(lines[0]!, /set\s+lang\s+eligible\s+image\s+native\s+en-fb\s+missing\s+cov%/);
  assert.match(out, /100\.0%/);
  assert.match(out, /72\.0%/);
  // every data line shares the column count of the header
  assert.equal(lines.length, 4); // header + separator + 2 rows
});
