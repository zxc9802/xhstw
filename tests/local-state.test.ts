import assert from "node:assert/strict";
import test from "node:test";
import { loadVersionedState, saveVersionedState, type StorageLike } from "../lib/utils/local-state";

function createMemoryStorage() {
  const values = new Map<string, string>();
  const storage: StorageLike = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    }
  };
  return { storage, values };
}

test("versioned state round trips through browser-like storage", () => {
  const { storage } = createMemoryStorage();

  saveVersionedState(storage, "draft", 1, { title: "保留" });

  assert.deepEqual(loadVersionedState(storage, "draft", 1, { title: "默认" }), { title: "保留" });
});

test("version mismatch and malformed JSON fall back safely", () => {
  const { storage, values } = createMemoryStorage();
  saveVersionedState(storage, "draft", 1, { title: "旧版" });

  assert.deepEqual(loadVersionedState(storage, "draft", 2, { title: "默认" }), { title: "默认" });

  values.set("draft", "not-json");
  assert.deepEqual(loadVersionedState(storage, "draft", 1, { title: "默认" }), { title: "默认" });
});
