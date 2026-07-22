import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("app/accounts/page.tsx", "utf8");

test("account rows and avatars persist in browser storage", () => {
  assert.equal(source.includes("content-production-studio.accounts"), true);
  assert.equal(source.includes("loadVersionedState"), true);
  assert.equal(source.includes("saveVersionedState"), true);
  assert.equal(source.includes("if (!saveVersionedState"), true);
  assert.equal(source.includes("persistImageFile"), true);
  assert.equal(source.includes('accept="image/*"'), true);
});

test("account rows expose edit and confirmed delete actions", () => {
  assert.equal(source.includes(">编辑<"), true);
  assert.equal(source.includes(">删除<"), true);
  assert.equal(source.includes("window.confirm"), true);
  assert.equal(source.includes('variant="danger"'), true);
});

test("an unsaved avatar preview stays inside the edit dialog", () => {
  const uploadBlock = source.slice(source.indexOf("const uploadEditingAvatar"), source.indexOf("const avatarUrlFor"));
  assert.equal(source.includes("editingAvatarPreview"), true);
  assert.equal(uploadBlock.includes("setResolvedAvatarMap"), false);
});
