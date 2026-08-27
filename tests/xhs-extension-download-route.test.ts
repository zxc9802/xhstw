import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { NextRequest } from "next/server";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const routePath = path.join(repoRoot, "app", "api", "extension", "download", "route.ts");

test("redirects every workbench to the same current extension package", async () => {
  assert.equal(existsSync(routePath), true, "current extension download route must exist");
  if (!existsSync(routePath)) return;

  const route = await import("../app/api/extension/download/route");
  const localResponse = await route.GET(new NextRequest("http://127.0.0.1:3000/api/extension/download", {
    headers: { host: "127.0.0.1:3000" }
  }));
  const productionResponse = await route.GET(new NextRequest("https://xhstw.qycm.top/api/extension/download", {
    headers: { host: "xhstw.qycm.top" }
  }));

  assert.equal(localResponse.status, 307);
  assert.equal(
    localResponse.headers.get("location"),
    "/downloads/xhs-browser-extension-0.1.31.zip"
  );
  assert.equal(productionResponse.status, 307);
  assert.equal(
    productionResponse.headers.get("location"),
    "/downloads/xhs-browser-extension-0.1.31.zip"
  );
});
