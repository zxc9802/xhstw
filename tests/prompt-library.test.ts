import assert from "node:assert/strict";
import test from "node:test";
import {
  createPromptLibraryItem,
  deletePromptLibraryItem,
  normalizePromptLibraryInput,
  sanitizePromptLibraryItems,
  searchPromptLibrary,
  updatePromptLibraryItem
} from "../lib/utils/prompt-library";

test("prompt input accepts an empty name but requires nonblank content", () => {
  assert.deepEqual(normalizePromptLibraryInput("  ", "  真实产品摄影  "), {
    name: "",
    content: "真实产品摄影"
  });
  assert.equal(normalizePromptLibraryInput("封面", "   "), null);
});

test("prompt search matches trimmed keywords against name and content without English case sensitivity", () => {
  const items = [
    createPromptLibraryItem({ name: "Hero Shot", content: "白色背景产品图" }, "one", "2026-09-01T00:00:00.000Z"),
    createPromptLibraryItem({ name: "详情页", content: "Close-up of the bottle" }, "two", "2026-09-01T00:01:00.000Z")
  ];

  assert.deepEqual(searchPromptLibrary(items, "  hero ").map((item) => item.id), ["one"]);
  assert.deepEqual(searchPromptLibrary(items, " close-UP ").map((item) => item.id), ["two"]);
  assert.deepEqual(searchPromptLibrary(items, "  "), items);
});

test("prompt items can be created, edited, and deleted without changing their creation time", () => {
  const created = createPromptLibraryItem({ name: "封面", content: "旧提示词" }, "one", "2026-09-01T00:00:00.000Z");
  const updated = updatePromptLibraryItem([created], "one", { name: "", content: "新提示词" }, "2026-09-01T00:02:00.000Z");

  assert.deepEqual(updated[0], {
    id: "one",
    name: "",
    content: "新提示词",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:02:00.000Z"
  });
  assert.deepEqual(deletePromptLibraryItem(updated, "one"), []);
});

test("stored prompt data keeps only valid complete items", () => {
  assert.deepEqual(sanitizePromptLibraryItems([
    { id: "one", name: "", content: "保留", createdAt: "a", updatedAt: "b" },
    { id: "two", name: "坏数据", content: "", createdAt: "a", updatedAt: "b" },
    null
  ]), [
    { id: "one", name: "", content: "保留", createdAt: "a", updatedAt: "b" }
  ]);
  assert.deepEqual(sanitizePromptLibraryItems({}), []);
});
