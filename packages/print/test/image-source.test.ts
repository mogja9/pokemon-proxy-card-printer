import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeImagePath, imagesBaseDir } from '../src/image-source.js';

const BASE = '/srv/data/images';

test('safeImagePath: resolves keys under the base', () => {
  assert.equal(
    safeImagePath(BASE, 'src/malie_io/en/sv1/001.png'),
    '/srv/data/images/src/malie_io/en/sv1/001.png',
  );
  assert.equal(safeImagePath(BASE, 'a/b.png'), '/srv/data/images/a/b.png');
});

test('safeImagePath: rejects path traversal', () => {
  assert.equal(safeImagePath(BASE, '../etc/passwd'), null);
  assert.equal(safeImagePath(BASE, 'src/../../etc/passwd'), null);
  assert.equal(safeImagePath(BASE, 'ok/../../../escape'), null);
});

test('imagesBaseDir: IMAGES_DIR override else ./data/images', () => {
  assert.equal(imagesBaseDir({ IMAGES_DIR: '/custom/imgs' } as NodeJS.ProcessEnv), '/custom/imgs');
  const def = imagesBaseDir({} as NodeJS.ProcessEnv);
  assert.ok(def.endsWith('/data/images'));
});
