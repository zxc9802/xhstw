import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(repoRoot, "scripts", "package-xhs-extension.ps1");
const archivePath = path.join(repoRoot, "public", "downloads", "xhs-browser-extension-0.1.33.zip");

test("keeps the unpacked extension on the current release version", () => {
  const manifest = JSON.parse(readFileSync(path.join(repoRoot, "扩展", "manifest.json"), "utf8")) as {
    version: string;
    host_permissions: string[];
    content_scripts: Array<{ matches: string[] }>;
  };

  assert.equal(manifest.version, "0.1.33");
  assert.equal(manifest.host_permissions.includes("http://127.0.0.1:3000/*"), true);
  assert.equal(manifest.host_permissions.includes("https://xhstw.qycm.top/*"), true);
  assert.deepEqual(manifest.content_scripts[0]?.matches, [
    "https://xhstw.qycm.top/*",
    "http://127.0.0.1:3000/*"
  ]);
});

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
      "Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory($env:XHS_EXTENSION_ARCHIVE, $env:XHS_EXTENSION_EXTRACTION)"
    ], {
      stdio: "pipe",
      env: {
        ...process.env,
        XHS_EXTENSION_ARCHIVE: archivePath,
        XHS_EXTENSION_EXTRACTION: extractionRoot
      }
    });
    const requiredFiles = [
      "manifest.json",
      "background.js",
      "app-bridge.js",
      "xhs-content.js",
      "library2-bar.js",
      path.join("shared", "protocol.js"),
      path.join("shared", "collector.js"),
      path.join("shared", "media-transfer.js"),
      path.join("shared", "library2-media.js"),
      path.join("shared", "library2-live.js"),
      path.join("shared", "library2-session.js"),
      path.join("shared", "library2-upload.js"),
      path.join("shared", "page-extract.js"),
      path.join("shared", "task-state.js"),
      "安装说明.md"
    ];

    for (const file of requiredFiles) {
      assert.equal(existsSync(path.join(extractionRoot, file)), true, `missing ${file}`);
    }

    const manifest = JSON.parse(readFileSync(path.join(extractionRoot, "manifest.json"), "utf8")) as {
      version: string;
      host_permissions: string[];
      content_scripts: Array<{ matches: string[] }>;
    };
    assert.equal(manifest.version, "0.1.33");
    assert.equal(manifest.host_permissions.includes("https://xhstw.qycm.top/*"), true);
    assert.equal(manifest.host_permissions.includes("http://127.0.0.1:3000/*"), true);
    assert.deepEqual(manifest.content_scripts[0]?.matches, [
      "https://xhstw.qycm.top/*",
      "http://127.0.0.1:3000/*"
    ]);

    const protocolSource = readFileSync(path.join(extractionRoot, "shared", "protocol.js"), "utf8");
    assert.match(protocolSource, /const PROTOCOL_VERSION = 3;/);
    const packagedPageExtract = readFileSync(path.join(extractionRoot, "shared", "page-extract.js"), "utf8");
    const canonicalPageExtract = readFileSync(path.join(repoRoot, "browser-extension", "shared", "page-extract.js"), "utf8");
    assert.equal(packagedPageExtract, canonicalPageExtract, "download archive must contain the latest page extractor");
  } finally {
    const resolvedTemp = path.resolve(tmpdir());
    const resolvedExtraction = path.resolve(extractionRoot);
    assert.equal(resolvedExtraction.startsWith(`${resolvedTemp}${path.sep}`), true);
    rmSync(resolvedExtraction, { recursive: true, force: true });
  }
});
