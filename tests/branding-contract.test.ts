import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const brandedFiles = [
  "app/layout.tsx",
  "components/layout/AppShell.tsx",
  "app/content/page.tsx"
];
const uiSource = brandedFiles.map((file) => readFileSync(file, "utf8")).join("\n");
const topicSource = readFileSync("app/topics/page.tsx", "utf8");

test("uses neutral production-studio branding", () => {
  for (const phrase of ["小红书图文生产状态", "小红书图文生产", "Xiaohongshu Image Studio"]) {
    assert.equal(uiSource.includes(phrase), false, phrase);
  }
  assert.equal(uiSource.includes("图文生产中台"), true);
  assert.equal(uiSource.includes("图文生产状态"), true);
});

test("topic page uses a platform-neutral list heading", () => {
  assert.equal(topicSource.includes("`${platform} 选题列表`"), false);
  assert.equal(topicSource.includes('"选题列表"'), true);
});

test("real platform fields remain available", () => {
  const accountSource = readFileSync("app/accounts/page.tsx", "utf8");
  assert.equal(accountSource.includes('const platformTabs = ["小红书"]'), true);
});
