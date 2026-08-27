import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const modulePath = path.resolve("browser-extension/shared/library2-upload.js");

type UploadHelper = {
  runBounded<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]>;
  uploadLibraryImages<T>(uploads: T[], put: (upload: T, index: number) => Promise<Response>): Promise<boolean[]>;
};

function loadUpload(): UploadHelper {
  assert.equal(existsSync(modulePath), true, "library2 bounded upload helper must exist");
  return require(modulePath) as UploadHelper;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function nextTurn() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

test("runs at most four uploads and returns results in input order", async () => {
  const upload = loadUpload();
  let active = 0;
  let peak = 0;
  const gates = Array.from({ length: 7 }, deferred);
  const started: number[] = [];
  const pending = upload.runBounded(
    Array.from({ length: 7 }, (_, index) => index),
    4,
    async (value, index) => {
      active += 1;
      peak = Math.max(peak, active);
      started.push(index);
      await gates[index]!.promise;
      active -= 1;
      return value * 10;
    }
  );

  await nextTurn();
  assert.deepEqual(started, [0, 1, 2, 3]);
  gates[1]!.resolve();
  await nextTurn();
  assert.equal(started.includes(4), true);
  gates.forEach((gate) => gate.resolve());

  assert.deepEqual(await pending, [0, 10, 20, 30, 40, 50, 60]);
  assert.equal(peak, 4);
});

test("reports the original one-based index when an upload fails", async () => {
  const upload = loadUpload();
  await assert.rejects(
    upload.uploadLibraryImages(["a", "b", "c"], async (_value, index) => (
      new Response(null, { status: index === 1 ? 502 : 200 })
    )),
    /第 2 张图片上传失败/
  );
});
