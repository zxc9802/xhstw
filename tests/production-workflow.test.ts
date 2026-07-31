import assert from "node:assert/strict";
import test from "node:test";
import {
  addKeywordValues,
  prependAssignedImages,
  removeKeywordValue,
  removeAssignedImage,
  reorderAssignedImages,
  reorderImageUrls,
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
  assert.deepEqual(reorderAssignedImages({ 0: ["a", "b", "c"] }, 0, "a", "b", "after"), { 0: ["b", "a", "c"] });
  assert.deepEqual(reorderAssignedImages({ 0: ["a", "b", "c"] }, 0, "a", "c", "after"), { 0: ["b", "c", "a"] });
});

test("unknown image reorder inputs keep the current logical order", () => {
  const current = { 0: ["a", "b"] };

  assert.deepEqual(reorderAssignedImages(current, 0, "missing", "a"), current);
  assert.deepEqual(reorderAssignedImages(current, 0, "a", "missing"), current);
});

test("newly uploaded finished images are selected before older images", () => {
  assert.deepEqual(
    prependAssignedImages({ 0: ["old-a", "old-b"] }, 0, ["new-a", "new-b"]),
    { 0: ["new-a", "new-b", "old-a", "old-b"] }
  );
});

test("deleting an uploaded finished image removes every work assignment", () => {
  assert.deepEqual(
    removeAssignedImage({ 0: ["keep", "remove"], 1: ["remove", "other"] }, "remove"),
    { 0: ["keep"], 1: ["other"] }
  );
});

test("content-library images preserve drag-and-drop ordering", () => {
  assert.deepEqual(reorderImageUrls(["a", "b", "c"], "c", "a"), ["c", "a", "b"]);
  assert.deepEqual(reorderImageUrls(["a", "b", "c"], "a", "b", "after"), ["b", "a", "c"]);
});

test("exports selected items when present and otherwise visible items", () => {
  const visible = [{ id: "visible" }];

  assert.deepEqual(selectExportTargets([{ id: "selected" }], visible), [{ id: "selected" }]);
  assert.deepEqual(selectExportTargets([], visible), visible);
});
