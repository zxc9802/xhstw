import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("app/content/page.tsx", "utf8");
const imageStoreSource = readFileSync("lib/utils/image-store.ts", "utf8");

test("persists keyword-library and image-draft state with versioned keys", () => {
  assert.equal(source.includes("content-production-studio.keyword-library"), true);
  assert.equal(source.includes("content-production-studio.image-draft"), true);
  assert.equal(source.includes("loadVersionedState"), true);
  assert.equal(source.includes("saveVersionedState"), true);
});

test("new and selected works do not receive preselected keywords", () => {
  assert.equal(source.includes("withoutSelectedKeywords"), true);
  assert.equal(source.includes("visibleKeywordLibrary.slice(0, 4)"), false);
});

test("P-page prompt fields and requests no longer fall back to mock prompts", () => {
  assert.equal(source.includes("planPromptMap[item.page] ?? item.prompt"), false);
  assert.equal(source.includes("planPromptMap[page] || plan.prompt"), false);
  assert.equal(source.includes("planPromptMap[page] ?? plan.prompt"), false);
  assert.equal(source.includes("useState(\"延续参考作品结构，但画面更干净真实；突出通勤、防晒补涂、清爽肤感。\")"), false);
  assert.equal(source.includes("const [imagePromptText, setImagePromptText] = useState(\"\")"), true);
});

test("local source images use a stable IndexedDB reference", () => {
  assert.equal(source.includes("persistImageFile"), true);
  assert.equal(imageStoreSource.includes("export async function persistImageFile"), true);
});
