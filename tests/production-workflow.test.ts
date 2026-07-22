import assert from "node:assert/strict";
import test from "node:test";
import {
  addKeywordValues,
  removeKeywordValue,
  reorderAssignedImages,
  selectExportTargets,
  withoutSelectedKeywords
} from "../lib/utils/production-workflow";

test("keyword additions persist while deleted defaults remain hidden", () => {
  const added = addKeywordValues({ customKeywords: [], hiddenKeywords: ["防晒"] }, ["防晒", "通勤"]);

  assert.deepEqual(added, { customKeywords: ["防晒", "通勤"], hiddenKeywords: [] });
  assert.deepEqual(removeKeywordValue(added, "通勤"), { customKeywords: ["防晒"], hiddenKeywords: ["通勤"] });
});

test("new work keeps copy fields but starts with no selected keywords", () => {
  assert.deepEqual(withoutSelectedKeywords({ id: "A1", title: "标题", tags: ["防晒"] }), {
    id: "A1",
    title: "标题",
    tags: []
  });
});

test("selected images preserve a user-defined horizontal order", () => {
  assert.deepEqual(reorderAssignedImages({ 0: ["a", "b", "c"] }, 0, "c", "a"), { 0: ["c", "a", "b"] });
});

test("unknown image reorder inputs keep the current logical order", () => {
  const current = { 0: ["a", "b"] };

  assert.deepEqual(reorderAssignedImages(current, 0, "missing", "a"), current);
  assert.deepEqual(reorderAssignedImages(current, 0, "a", "missing"), current);
});

test("exports selected items when present and otherwise visible items", () => {
  const visible = [{ id: "visible" }];

  assert.deepEqual(selectExportTargets([{ id: "selected" }], visible), [{ id: "selected" }]);
  assert.deepEqual(selectExportTargets([], visible), visible);
});
