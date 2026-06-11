import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadConfig,
  loadCompliance,
  assertSafeComplianceDefaults,
  mmToPx,
  LAUNCH_LANGS,
} from '../src/index.js';

const env = (o: Record<string, string>): NodeJS.ProcessEnv => o as NodeJS.ProcessEnv;

test('mmToPx: fixed 63x88mm trim px at 300/600 dpi', () => {
  assert.equal(mmToPx(63, 300), 744);
  assert.equal(mmToPx(88, 300), 1039);
  assert.equal(mmToPx(63, 600), 1488);
  assert.equal(mmToPx(88, 600), 2079);
});

test('loadConfig RESPECTS the injected env (regression: env arg was ignored)', () => {
  // Before the fix the helpers read process.env directly, so these injected
  // values were silently dropped and the defaults returned instead.
  const c = loadConfig(env({ DATABASE_URL: 'postgres://x', LAUNCH_LANGS: 'en,ja', INGEST_TCGDEX_RPS: '9' }));
  assert.equal(c.databaseUrl, 'postgres://x');
  assert.deepEqual(c.launchLangs, ['en', 'ja']);
  assert.equal(c.ingest.tcgdexRps, 9);
});

test('loadConfig: empty env -> documented defaults', () => {
  const c = loadConfig(env({}));
  assert.match(c.databaseUrl, /localhost:5432\/proxyforge/);
  assert.deepEqual(c.launchLangs, [...LAUNCH_LANGS]);
  assert.equal(c.search.backend, 'meili');
  assert.equal(c.ingest.tcgdexRps, 4);
  assert.equal(c.tcgdexBaseUrl, 'https://api.tcgdex.net/v2'); // trailing slash stripped
});

test('loadConfig: invalid OVERLAY_ADAPTER throws; non-pg SEARCH_BACKEND -> meili', () => {
  assert.throws(() => loadConfig(env({ OVERLAY_ADAPTER: 'bogus' })), /OVERLAY_ADAPTER/);
  assert.equal(loadConfig(env({ SEARCH_BACKEND: 'garbage' })).search.backend, 'meili');
  assert.equal(loadConfig(env({ SEARCH_BACKEND: 'pg' })).search.backend, 'pg');
});

test('parseLangs (via loadConfig): unsupported language throws', () => {
  assert.throws(() => loadConfig(env({ LAUNCH_LANGS: 'en,klingon' })), /unsupported language 'klingon'/);
});

test('envNum: non-numeric value falls back to the default', () => {
  assert.equal(loadConfig(env({ INGEST_TCGDEX_RPS: 'not-a-number' })).ingest.tcgdexRps, 4);
});

test('loadCompliance + assertSafeComplianceDefaults: safe defaults pass', () => {
  const c = loadCompliance(env({}));
  assert.equal(c.defaultServingMode, 'ephemeral');
  assert.equal(c.pricingEnabled, false);
  assert.equal(c.noindex, true);
  assert.doesNotThrow(() => assertSafeComplianceDefaults(c));
});

test('assertSafeComplianceDefaults: rejects unsafe overrides', () => {
  const bad = loadCompliance(
    env({ COMPLIANCE_PRICING_ENABLED: 'true', COMPLIANCE_DEFAULT_SERVING_MODE: 'hotlink' }),
  );
  assert.equal(bad.pricingEnabled, true); // envBool parsed the injected env
  assert.throws(() => assertSafeComplianceDefaults(bad), /Unsafe compliance defaults/);
});
