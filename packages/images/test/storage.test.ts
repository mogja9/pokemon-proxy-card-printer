import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalFsStorage, createStorage } from '../src/storage.js';

test('LocalFsStorage: put/get round-trip, creates nested dirs, exists, url', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pf-storage-'));
  try {
    const s = new LocalFsStorage(dir);
    const key = 'src/malie_io/en/sv01/001.png';
    assert.equal(await s.exists(key), false); // nothing there yet

    const bytes = Buffer.from('PNGDATA');
    assert.equal(await s.put(key, bytes), key); // returns the key
    assert.equal(await s.exists(key), true);
    assert.deepEqual(await s.get(key), bytes); // same bytes back

    // physically written under baseDir at the key path (nested dirs auto-created)
    assert.deepEqual(await readFile(join(dir, key)), bytes);

    assert.equal(s.url(key), '/img/src/malie_io/en/sv01/001.png');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('LocalFsStorage: get on a missing key rejects', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pf-storage-'));
  try {
    await assert.rejects(() => new LocalFsStorage(dir).get('nope.png'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('createStorage: local by default; s3 not wired -> throws; honors IMAGES_DIR', async () => {
  assert.ok(createStorage({} as NodeJS.ProcessEnv) instanceof LocalFsStorage);
  assert.throws(() => createStorage({ STORAGE_BACKEND: 's3' } as NodeJS.ProcessEnv), /S3/);
  assert.ok(
    createStorage({ IMAGES_DIR: '/tmp/pf-custom-images' } as NodeJS.ProcessEnv) instanceof
      LocalFsStorage,
  );
});
