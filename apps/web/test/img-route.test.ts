/**
 * End-to-end test for the GET /img/[...key] route handler. safeImagePath (the
 * traversal guard) is unit-tested in @proxyforge/print, but the ROUTE wiring -
 * joining the key segments, calling the guard, the 400/404/content-type/200
 * behavior - was untested. This route serves files from disk by URL path, so a
 * wiring slip is an arbitrary-file-read. Points IMAGES_DIR at a temp dir with
 * known files and drives the handler directly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET } from '../app/img/[...key]/route';

const call = (key: string[]) =>
  GET(new Request('http://x/img'), { params: Promise.resolve({ key }) });

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 9, 9]);

test('img route serves stored files, guards traversal, 404s on miss', async () => {
  const base = await mkdtemp(join(tmpdir(), 'pf-img-'));
  const prevDir = process.env.IMAGES_DIR;
  process.env.IMAGES_DIR = base;
  try {
    await mkdir(join(base, 'src', 'malie_io', 'en', 'sv01'), { recursive: true });
    await writeFile(join(base, 'src', 'malie_io', 'en', 'sv01', '001.png'), PNG);
    await writeFile(join(base, 'card.webp'), WEBP);

    // 200: a stored PNG is returned verbatim with image/png + an immutable cache
    const ok = await call(['src', 'malie_io', 'en', 'sv01', '001.png']);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('content-type'), 'image/png');
    assert.match(ok.headers.get('cache-control') ?? '', /immutable/);
    assert.deepEqual(new Uint8Array(await ok.arrayBuffer()), PNG);

    // content-type follows the extension
    const webp = await call(['card.webp']);
    assert.equal(webp.status, 200);
    assert.equal(webp.headers.get('content-type'), 'image/webp');
    assert.deepEqual(new Uint8Array(await webp.arrayBuffer()), WEBP);

    // traversal out of the base dir is rejected by the guard -> 400 (not read)
    const evil = await call(['..', '..', '..', '..', 'etc', 'passwd']);
    assert.equal(evil.status, 400);

    // a key inside the base but with no file -> 404
    const miss = await call(['src', 'malie_io', 'en', 'sv01', 'nope.png']);
    assert.equal(miss.status, 404);
  } finally {
    if (prevDir === undefined) delete process.env.IMAGES_DIR;
    else process.env.IMAGES_DIR = prevDir;
    await rm(base, { recursive: true, force: true });
  }
});
