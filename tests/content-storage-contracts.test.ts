import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONTENT_IMAGE_MAX_BYTES,
  CONTENT_IMAGE_MAX_COUNT,
  CONTENT_IMAGE_TOTAL_MAX_BYTES,
  CONTENT_IMAGE_TYPES,
  CONTENT_MANIFEST_MAX_BYTES,
  CONTENT_UPLOAD_INTENT_TTL_MS,
  createContentId,
  imageObjectKey,
  manifestObjectKey,
  mediaFileId,
  parseImageDescriptors,
  userContentsPrefix,
} from '../lib/content-storage/contracts';

test('exports the content storage limits and image MIME mapping', () => {
  assert.equal(CONTENT_IMAGE_MAX_COUNT, 20);
  assert.equal(CONTENT_IMAGE_MAX_BYTES, 20 * 1024 * 1024);
  assert.equal(CONTENT_IMAGE_TOTAL_MAX_BYTES, 100 * 1024 * 1024);
  assert.equal(CONTENT_MANIFEST_MAX_BYTES, 1024 * 1024);
  assert.equal(CONTENT_UPLOAD_INTENT_TTL_MS, 10 * 60 * 1000);
  assert.deepEqual([...CONTENT_IMAGE_TYPES], [
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
    ['image/webp', 'webp'],
    ['image/gif', 'gif'],
    ['image/avif', 'avif'],
  ]);
});

test('creates compact content IDs with timestamp and UUID suffix', () => {
  const id = createContentId(new Date('2026-08-21T12:34:56.789Z'), '550e8400-e29b-41d4-a716-446655440000');
  assert.match(id, /^\d{8}T\d{9}Z-[0-9a-f]{12}$/);
  assert.equal(id, '20260821T123456789Z-550e8400e29b');
});

test('keeps owner IDs inside a safe URL-encoded contents prefix', () => {
  const prefix = userContentsPrefix('member/../../other');
  assert.equal(prefix, 'users/member%2F%2E%2E%2F%2E%2E%2Fother/contents/');
  assert.ok(!prefix.includes('../'));
  assert.equal(userContentsPrefix('a.b'), 'users/a%2Eb/contents/');
  assert.throws(() => userContentsPrefix(''), /ownerId/);
});

test('builds validated manifest and image object keys', () => {
  const contentId = '20260821T123456789Z-550e8400e29b';
  const fileId = mediaFileId(1, 'image/jpeg', '550e8400-e29b-41d4-a716-446655440000');
  assert.equal(fileId, 'image-01-550e8400e29b.jpg');
  assert.equal(manifestObjectKey('member', contentId), `users/member/contents/${contentId}/manifest.json`);
  assert.equal(imageObjectKey('member', contentId, fileId), `users/member/contents/${contentId}/images/${fileId}`);
  assert.throws(() => manifestObjectKey('member', '../bad'), /contentId/);
  assert.throws(() => imageObjectKey('member', contentId, '../bad.jpg'), /fileId/);
});

test('generates stable safe file IDs for JPEG and AVIF', () => {
  const id = '550e8400-e29b-41d4-a716-446655440000';
  assert.equal(mediaFileId(1, 'image/jpeg', id), 'image-01-550e8400e29b.jpg');
  assert.equal(mediaFileId(2, 'image/avif', id), 'image-02-550e8400e29b.avif');
});

test('accepts valid image descriptors', () => {
  const descriptors = parseImageDescriptors([
    { name: 'cover.jpg', contentType: 'image/jpeg', size: 1024 },
    { name: 'detail.avif', contentType: 'image/avif', size: 2048 },
  ]);
  assert.deepEqual(descriptors, [
    { name: 'cover.jpg', contentType: 'image/jpeg', size: 1024 },
    { name: 'detail.avif', contentType: 'image/avif', size: 2048 },
  ]);
});

test('rejects more than 20 image descriptors', () => {
  assert.throws(
    () => parseImageDescriptors(Array.from({ length: 21 }, (_, index) => ({ name: `${index}.jpg`, contentType: 'image/jpeg', size: 1 }))),
    /最多 20 张/,
  );
});

test('rejects an image larger than 20 MB', () => {
  assert.throws(
    () => parseImageDescriptors([{ name: 'large.jpg', contentType: 'image/jpeg', size: CONTENT_IMAGE_MAX_BYTES + 1 }]),
    /单张图片不能超过 20 MB/,
  );
});

test('rejects total image size larger than 100 MB', () => {
  assert.throws(
    () => parseImageDescriptors(Array.from({ length: 6 }, (_, index) => ({ name: `${index}.jpg`, contentType: 'image/jpeg', size: 20 * 1024 * 1024 }))),
    /图片总大小不能超过 100 MB/,
  );
});

test('rejects SVG image descriptors', () => {
  assert.throws(
    () => parseImageDescriptors([{ name: 'vector.svg', contentType: 'image/svg+xml', size: 100 }]),
    /不支持的图片类型/,
  );
});
