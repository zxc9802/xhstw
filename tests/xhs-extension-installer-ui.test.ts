import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  ExtensionInstallDialog,
  ExtensionInstaller,
  XHS_EXTENSION_DOWNLOAD_PATH
} from "../components/extension/ExtensionInstaller";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("renders a direct extension download control", () => {
  const markup = renderToStaticMarkup(React.createElement(ExtensionInstaller));
  assert.equal(XHS_EXTENSION_DOWNLOAD_PATH, "/downloads/xhs-browser-extension-0.1.12.zip");
  assert.match(markup, /下载插件/);
  assert.match(markup, /安装说明/);
  assert.match(markup, /href="\/downloads\/xhs-browser-extension-0\.1\.12\.zip"/);
  assert.match(markup, /download=""/);
});

test("renders the complete Chrome and Edge installation guide", () => {
  const markup = renderToStaticMarkup(React.createElement(ExtensionInstallDialog, {
    onClose() {}
  }));

  for (const requiredText of [
    "chrome://extensions",
    "edge://extensions",
    "开发者模式",
    "把刚刚下载的压缩包里的文件放在一个文件夹里",
    "选择这个文件夹",
    "本机抓取已连接",
    "升级插件",
    "300013",
    "不要反复卸载、重装或刷新"
  ]) {
    assert.equal(markup.includes(requiredText), true, `missing guide text: ${requiredText}`);
  }
  assert.match(markup, /aria-modal="true"/);
  assert.match(markup, /我知道了/);
});

test("mounts the installer before the notification button in the top bar", () => {
  const appShellSource = readFileSync(path.join(repoRoot, "components", "layout", "AppShell.tsx"), "utf8");
  const installerIndex = appShellSource.indexOf("<ExtensionInstaller />");
  const notificationIndex = appShellSource.indexOf('title="通知"');

  assert.notEqual(installerIndex, -1, "AppShell must mount ExtensionInstaller");
  assert.notEqual(notificationIndex, -1, "AppShell notification button must remain");
  assert.equal(installerIndex < notificationIndex, true, "installer must appear left of notification");
});

test("portals the dialog outside the sticky header containing block", () => {
  const installerSource = readFileSync(path.join(repoRoot, "components", "extension", "ExtensionInstaller.tsx"), "utf8");

  assert.match(installerSource, /createPortal\(/);
  assert.match(installerSource, /document\.body/);
});
