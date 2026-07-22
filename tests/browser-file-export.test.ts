import assert from "node:assert/strict";
import test from "node:test";
import {
  imageExtension,
  safeFileName,
  writeBlobFiles,
  type WritableDirectoryLike
} from "../lib/utils/browser-file-export";

test("sanitizes Windows-unsafe filename characters", () => {
  assert.equal(safeFileName("作品: A/B?"), "作品_ A_B_");
  assert.equal(safeFileName("  .  "), "未命名");
});

test("infers image extensions from MIME types", () => {
  assert.equal(imageExtension(new Blob([], { type: "image/png" })), "png");
  assert.equal(imageExtension(new Blob([], { type: "image/jpeg" })), "jpg");
  assert.equal(imageExtension(new Blob([], { type: "image/webp" })), "webp");
  assert.equal(imageExtension(new Blob([], { type: "image/gif" })), "gif");
  assert.equal(imageExtension(new Blob([], { type: "application/octet-stream" })), "png");
});

test("writes every valid blob and continues after an individual failure", async () => {
  const written = new Map<string, Blob>();
  const closed: string[] = [];
  const directory: WritableDirectoryLike = {
    name: "exports",
    async getFileHandle(name) {
      if (name === "broken.png") throw new Error("permission denied");
      return {
        async createWritable() {
          return {
            async write(data) {
              written.set(name, data);
            },
            async close() {
              closed.push(name);
            }
          };
        }
      };
    }
  };

  const result = await writeBlobFiles(directory, [
    { name: "first.png", blob: new Blob(["first"], { type: "image/png" }) },
    { name: "broken.png", blob: new Blob(["broken"], { type: "image/png" }) },
    { name: "last.webp", blob: new Blob(["last"], { type: "image/webp" }) }
  ]);

  assert.deepEqual(result, { saved: 2, failed: 1, errors: ["broken.png: permission denied"] });
  assert.deepEqual([...written.keys()], ["first.png", "last.webp"]);
  assert.deepEqual(closed, ["first.png", "last.webp"]);
});
