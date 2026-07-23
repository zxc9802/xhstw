import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(repoRoot, "scripts", "package-xhs-extension.ps1");
const archivePath = path.join(repoRoot, "public", "downloads", "xhs-browser-extension-0.1.12.zip");

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
      "Expand-Archive -LiteralPath $env:XHS_EXTENSION_ARCHIVE -DestinationPath $env:XHS_EXTENSION_EXTRACTION -Force"
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
      path.join("shared", "protocol.js"),
      path.join("shared", "collector.js"),
      path.join("shared", "media-transfer.js"),
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
    assert.equal(manifest.version, "0.1.12");
    assert.equal(manifest.host_permissions.includes("https://xhstw.qycm.top/*"), true);
    const protocolSource = readFileSync(path.join(extractionRoot, "shared", "protocol.js"), "utf8");
    assert.match(protocolSource, /const PROTOCOL_VERSION = 3;/);
  } finally {
    const resolvedTemp = path.resolve(tmpdir());
    const resolvedExtraction = path.resolve(extractionRoot);
    assert.equal(resolvedExtraction.startsWith(`${resolvedTemp}${path.sep}`), true);
    rmSync(resolvedExtraction, { recursive: true, force: true });
  }
});
