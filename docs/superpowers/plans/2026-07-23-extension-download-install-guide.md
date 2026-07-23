# XHS Extension Download and Install Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a top-bar download button for the real Xiaohongshu browser extension and a companion in-site installation guide dialog.

**Architecture:** Track the existing `扩展` directory as the canonical extension source, package it into a versioned static ZIP under `public/downloads`, and link that artifact directly from a focused client component. `AppShell` only mounts the component before the existing notification button; the component owns the two controls and the local dialog state. No API route, remote download service, or existing collection flow changes are introduced.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS, Lucide React, Node `node:test`/`tsx`, PowerShell `Compress-Archive`.

---

## File map

- Add existing `扩展/manifest.json`, `扩展/background.js`, `扩展/app-bridge.js`, `扩展/xhs-content.js`, `扩展/shared/*.js`, and `扩展/安装说明.md` — canonical tracked extension source.
- Create `scripts/package-xhs-extension.ps1` — validate the source tree and produce the versioned public ZIP.
- Create `public/downloads/xhs-browser-extension-0.1.10.zip` — same-origin production download artifact.
- Create `tests/xhs-extension-download.test.ts` — package completeness, manifest version, host scope, and public artifact checks.
- Create `components/extension/ExtensionInstaller.tsx` — top-bar controls plus installation dialog.
- Modify `components/layout/AppShell.tsx:16-17,96-100` — mount the installer immediately before the notification button.
- Create `tests/xhs-extension-installer-ui.test.ts` — rendered labels, download target, guide content, and source-order placement checks.

### Task 1: Track and package the real extension

**Files:**
- Add existing: `扩展/manifest.json`
- Add existing: `扩展/background.js`
- Add existing: `扩展/app-bridge.js`
- Add existing: `扩展/xhs-content.js`
- Add existing: `扩展/shared/protocol.js`
- Add existing: `扩展/shared/collector.js`
- Add existing: `扩展/shared/task-state.js`
- Add existing: `扩展/安装说明.md`
- Create: `scripts/package-xhs-extension.ps1`
- Create: `public/downloads/xhs-browser-extension-0.1.10.zip`
- Test: `tests/xhs-extension-download.test.ts`

- [ ] **Step 1: Write the failing packaging test**

Create `tests/xhs-extension-download.test.ts`:

```ts
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(repoRoot, "scripts", "package-xhs-extension.ps1");
const archivePath = path.join(repoRoot, "public", "downloads", "xhs-browser-extension-0.1.10.zip");

test("packages the complete scoped extension into the public download path", {
  skip: process.platform !== "win32"
}, () => {
  assert.equal(existsSync(scriptPath), true, "packaging script must exist");

  execFileSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", scriptPath
  ], { cwd: repoRoot, stdio: "pipe" });

  assert.equal(existsSync(archivePath), true, "public extension zip must exist");

  const extractionRoot = mkdtempSync(path.join(tmpdir(), "xhs-extension-test-"));
  try {
    execFileSync("powershell.exe", [
      "-NoProfile",
      "-Command",
      "Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force",
      archivePath,
      extractionRoot
    ], { stdio: "pipe" });

    const requiredFiles = [
      "manifest.json",
      "background.js",
      "app-bridge.js",
      "xhs-content.js",
      path.join("shared", "protocol.js"),
      path.join("shared", "collector.js"),
      path.join("shared", "task-state.js"),
      "安装说明.md"
    ];

    for (const file of requiredFiles) {
      assert.equal(existsSync(path.join(extractionRoot, file)), true, `missing ${file}`);
    }

    const manifest = JSON.parse(readFileSync(path.join(extractionRoot, "manifest.json"), "utf8")) as {
      version: string;
      host_permissions: string[];
    };
    assert.equal(manifest.version, "0.1.10");
    assert.equal(manifest.host_permissions.includes("https://xhstw.qycm.top/*"), true);
  } finally {
    const resolvedTemp = path.resolve(tmpdir());
    const resolvedExtraction = path.resolve(extractionRoot);
    assert.equal(resolvedExtraction.startsWith(`${resolvedTemp}${path.sep}`), true);
    rmSync(resolvedExtraction, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
npx.cmd tsx --test tests/xhs-extension-download.test.ts
```

Expected: FAIL with `packaging script must exist` because `scripts/package-xhs-extension.ps1` has not been created.

- [ ] **Step 3: Implement the minimal packaging script**

Create `scripts/package-xhs-extension.ps1`:

```powershell
$ErrorActionPreference = "Stop"

$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$sourceRoot = [System.IO.Path]::GetFullPath((Join-Path $repositoryRoot "扩展"))
$manifestPath = Join-Path $sourceRoot "manifest.json"
$requiredFiles = @(
  "manifest.json",
  "background.js",
  "app-bridge.js",
  "xhs-content.js",
  "shared\protocol.js",
  "shared\collector.js",
  "shared\task-state.js",
  "安装说明.md"
)

foreach ($relativePath in $requiredFiles) {
  $candidate = Join-Path $sourceRoot $relativePath
  if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
    throw "扩展打包失败，缺少文件：$relativePath"
  }
}

$manifest = Get-Content -Raw -Encoding utf8 -LiteralPath $manifestPath | ConvertFrom-Json
$version = [string]$manifest.version
if ($version -notmatch '^\d+\.\d+\.\d+$') {
  throw "扩展打包失败，manifest.json 版本号无效：$version"
}

$outputDirectory = [System.IO.Path]::GetFullPath((Join-Path $repositoryRoot "public\downloads"))
$outputPath = [System.IO.Path]::GetFullPath((Join-Path $outputDirectory "xhs-browser-extension-$version.zip"))
$expectedPrefix = $outputDirectory.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (-not $outputPath.StartsWith($expectedPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "扩展下载文件必须位于 public\downloads。"
}

New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
if (Test-Path -LiteralPath $outputPath) {
  Remove-Item -LiteralPath $outputPath -Force
}

Compress-Archive -Path (Join-Path $sourceRoot "*") -DestinationPath $outputPath -CompressionLevel Optimal
$hash = Get-FileHash -Algorithm SHA256 -LiteralPath $outputPath

Write-Output "扩展下载包：$outputPath"
Write-Output "SHA-256：$($hash.Hash)"
```

- [ ] **Step 4: Run the packaging script once to create the real public artifact**

Run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/package-xhs-extension.ps1
```

Expected: exit code `0`, output path ending in `public\downloads\xhs-browser-extension-0.1.10.zip`, and a SHA-256 value.

- [ ] **Step 5: Run the focused test and verify it passes**

Run:

```powershell
npx.cmd tsx --test tests/xhs-extension-download.test.ts
```

Expected: `1` test PASS; the expanded archive contains all eight required files, version `0.1.10`, and `https://xhstw.qycm.top/*`.

- [ ] **Step 6: Commit the extension source and packaging artifact**

Run:

```powershell
git add -- '扩展' 'scripts/package-xhs-extension.ps1' 'public/downloads/xhs-browser-extension-0.1.10.zip' 'tests/xhs-extension-download.test.ts'
git diff --cached --check
git commit -m "feat: package xhs browser extension download"
```

Expected: only the listed extension, script, ZIP, and test files are committed.

### Task 2: Add the top-bar controls and installation dialog

**Files:**
- Create: `components/extension/ExtensionInstaller.tsx`
- Modify: `components/layout/AppShell.tsx:16-17,96-100`
- Test: `tests/xhs-extension-installer-ui.test.ts`

- [ ] **Step 1: Write the failing UI contract tests**

Create `tests/xhs-extension-installer-ui.test.ts`:

```ts
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
  assert.equal(XHS_EXTENSION_DOWNLOAD_PATH, "/downloads/xhs-browser-extension-0.1.10.zip");
  assert.match(markup, /下载插件/);
  assert.match(markup, /安装说明/);
  assert.match(markup, /href="\/downloads\/xhs-browser-extension-0\.1\.10\.zip"/);
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
    "加载已解压的扩展",
    "manifest.json",
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
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
npx.cmd tsx --test tests/xhs-extension-installer-ui.test.ts
```

Expected: FAIL because `components/extension/ExtensionInstaller.tsx` does not exist.

- [ ] **Step 3: Implement the focused installer component**

Create `components/extension/ExtensionInstaller.tsx`:

```tsx
"use client";

import { useState } from "react";
import { CircleHelp, Download, X } from "lucide-react";

export const XHS_EXTENSION_DOWNLOAD_PATH = "/downloads/xhs-browser-extension-0.1.10.zip";

export function ExtensionInstaller() {
  const [guideOpen, setGuideOpen] = useState(false);

  return (
    <>
      <div className="flex items-center gap-2">
        <a
          href={XHS_EXTENSION_DOWNLOAD_PATH}
          download
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-emerald-700 px-3 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-800"
        >
          <Download className="h-4 w-4" />
          下载插件
        </a>
        <button
          type="button"
          onClick={() => setGuideOpen(true)}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-medium text-ink transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-800"
        >
          <CircleHelp className="h-4 w-4" />
          安装说明
        </button>
      </div>

      {guideOpen ? <ExtensionInstallDialog onClose={() => setGuideOpen(false)} /> : null}
    </>
  );
}

export function ExtensionInstallDialog({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 p-4"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="extension-install-title"
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-line bg-white shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 id="extension-install-title" className="text-lg font-semibold text-ink">小红书插件安装说明</h2>
            <p className="mt-1 text-sm text-muted">支持 Chrome 和 Edge，首次安装约需 1 分钟。</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭安装说明" className="rounded-md p-2 text-muted transition hover:bg-slate-100 hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 px-5 py-5 text-sm text-ink">
          <ol className="list-decimal space-y-3 pl-5 leading-6">
            <li>点击顶部“下载插件”，将 ZIP 完整解压到一个固定目录。</li>
            <li>Chrome 打开 <code className="rounded bg-slate-100 px-1.5 py-0.5">chrome://extensions</code>；Edge 打开 <code className="rounded bg-slate-100 px-1.5 py-0.5">edge://extensions</code>。</li>
            <li>开启扩展管理页右上角的“开发者模式”。</li>
            <li>点击“加载已解压的扩展”，选择直接包含 <code className="rounded bg-slate-100 px-1.5 py-0.5">manifest.json</code> 的目录。</li>
            <li>在同一个浏览器中打开小红书并完成登录。</li>
            <li>刷新生产网站，确认选题页显示“本机抓取已连接”。</li>
          </ol>

          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <h3 className="font-semibold text-amber-900">升级插件</h3>
            <p className="mt-1 leading-6 text-amber-800">先在扩展管理页移除旧版本，再解压新 ZIP、加载新目录并刷新网站。</p>
          </div>

          <div className="rounded-lg border border-red-200 bg-red-50 p-4">
            <h3 className="font-semibold text-red-900">遇到 300013 或访问频繁</h3>
            <p className="mt-1 leading-6 text-red-800">立即停止重试并等待页面提示的冷却时间。不要反复卸载、重装或刷新来绕过冷却。</p>
          </div>
        </div>

        <div className="flex justify-end border-t border-line px-5 py-4">
          <button type="button" onClick={onClose} className="inline-flex h-9 items-center justify-center rounded-md bg-emerald-700 px-4 text-sm font-medium text-white transition hover:bg-emerald-800">
            我知道了
          </button>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Mount the component before the existing notification button**

Modify `components/layout/AppShell.tsx` by adding:

```tsx
import { ExtensionInstaller } from "@/components/extension/ExtensionInstaller";
```

Then change the top-bar actions to:

```tsx
<div className="flex items-center gap-3">
  <ExtensionInstaller />
  <button className="relative flex h-9 w-9 items-center justify-center rounded-md border border-line bg-white text-muted transition hover:bg-orange-50 hover:text-orange-700" title="通知">
    <Bell className="h-4 w-4" />
    <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-orange-500" />
  </button>
</div>
```

- [ ] **Step 5: Run the focused UI tests and verify they pass**

Run:

```powershell
npx.cmd tsx --test tests/xhs-extension-installer-ui.test.ts
```

Expected: `3` tests PASS; the rendered download target and guide copy are present, and the installer mount occurs before the notification button.

- [ ] **Step 6: Commit the UI**

Run:

```powershell
git add -- 'components/extension/ExtensionInstaller.tsx' 'components/layout/AppShell.tsx' 'tests/xhs-extension-installer-ui.test.ts'
git diff --cached --check
git commit -m "feat: add extension download and install guide"
```

Expected: only the three UI files are committed.

### Task 3: Run full verification and inspect the actual page

**Files:**
- Modify only files from Tasks 1–2 if a verification failure proves a required correction.

- [ ] **Step 1: Run the complete automated suite**

Run:

```powershell
npm.cmd test
```

Expected: all tests PASS with zero failures.

- [ ] **Step 2: Run TypeScript and production build checks**

Run:

```powershell
npx.cmd tsc --noEmit
npm.cmd run build
```

Expected: TypeScript exits `0`; Next.js production build exits `0`.

- [ ] **Step 3: Rebuild and hash the final downloadable ZIP**

Run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/package-xhs-extension.ps1
Get-FileHash -Algorithm SHA256 -LiteralPath 'public\downloads\xhs-browser-extension-0.1.10.zip'
```

Expected: the packaging script exits `0`; `Get-FileHash` prints the final SHA-256.

- [ ] **Step 4: Check repository scope and whitespace**

Run:

```powershell
git status --short
git diff --check
git log -3 --oneline
```

Expected: no uncommitted implementation changes, no whitespace errors, and the two feature commits follow the design and plan commits.

- [ ] **Step 5: Inspect the live local layout**

Run the site:

```powershell
$devProcess = Start-Process -FilePath 'npm.cmd' -ArgumentList @('run', 'dev') -WorkingDirectory (Get-Location) -WindowStyle Hidden -PassThru
$devProcess.Id
```

Open `http://127.0.0.1:3000/topics` in a browser and verify:

1. “下载插件”和“安装说明” appear in the top bar immediately left of the notification bell.
2. Clicking “下载插件” downloads `xhs-browser-extension-0.1.10.zip`.
3. Clicking “安装说明” opens the guide without navigating away.
4. Clicking the close icon, “我知道了”, and the backdrop each closes the dialog.
5. The existing selection page and collection controls remain unchanged.

After inspection, stop only the process created above:

```powershell
Stop-Process -Id $devProcess.Id
```

- [ ] **Step 6: Create a correction commit only if verification required changes**

If Steps 1–5 expose a defect, return to the owning task, add a failing test for that exact defect, make the minimum correction, rerun the focused test and all verification commands, then stage only the corrected files:

```powershell
git add -- 'components/extension/ExtensionInstaller.tsx' 'components/layout/AppShell.tsx' 'scripts/package-xhs-extension.ps1' 'tests/xhs-extension-download.test.ts' 'tests/xhs-extension-installer-ui.test.ts' 'public/downloads/xhs-browser-extension-0.1.10.zip'
git diff --cached --check
git commit -m "fix: verify extension download experience"
```

If no files changed, do not create an empty commit.
