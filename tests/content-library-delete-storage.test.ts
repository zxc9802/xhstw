import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("keeps a migrated browser source untouched when COS deletion fails", async () => {
  const moduleUrl = new URL("../lib/content-storage/delete-library-item.ts", import.meta.url);
  assert.equal(existsSync(fileURLToPath(moduleUrl)), true, "delete storage coordinator must exist");
  const { deleteContentLibraryStorage } = await import(moduleUrl.href);
  const originalRaw = JSON.stringify([{
    id: "legacy-source",
    mediaUrls: ["cps-image://cover"]
  }]);
  let storedRaw = originalRaw;
  const events: string[] = [];

  await assert.rejects(() => deleteContentLibraryStorage(
    { source: "cos", id: "cos-item", legacySourceId: "legacy-source" },
    {
      deleteCosContent: async () => {
        events.push("cos");
        throw new Error("COS delete failed");
      },
      getLegacyContent: () => storedRaw,
      setLegacyContent: (value) => {
        events.push("local");
        storedRaw = value;
      },
      deleteLegacyImage: async () => { events.push("image"); }
    }
  ), /COS delete failed/);

  assert.equal(storedRaw, originalRaw);
  assert.deepEqual(events, ["cos"]);
});

test("removes a migrated browser source only after COS deletion succeeds", async () => {
  const moduleUrl = new URL("../lib/content-storage/delete-library-item.ts", import.meta.url);
  assert.equal(existsSync(fileURLToPath(moduleUrl)), true, "delete storage coordinator must exist");
  const { deleteContentLibraryStorage } = await import(moduleUrl.href);
  let storedRaw = JSON.stringify([{
    id: "legacy-source",
    mediaUrls: ["cps-image://cover"]
  }]);
  const events: string[] = [];

  const result = await deleteContentLibraryStorage(
    { source: "cos", id: "cos-item", legacySourceId: "legacy-source" },
    {
      deleteCosContent: async () => { events.push("cos"); },
      getLegacyContent: () => storedRaw,
      setLegacyContent: (value) => {
        events.push("local");
        storedRaw = value;
      },
      deleteLegacyImage: async () => { events.push("image"); }
    }
  );

  assert.deepEqual(JSON.parse(storedRaw), []);
  assert.deepEqual(events, ["cos", "local", "image"]);
  assert.deepEqual(result, { legacyId: "legacy-source", browserCleanupFailed: false });
});
