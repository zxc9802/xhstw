import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = path.join(repoRoot, "browser-extension", "shared", "library2-session.js");

test("keeps local and production workbench sessions independently", () => {
  assert.equal(existsSync(modulePath), true, "library2 session selector must exist");
  if (!existsSync(modulePath)) return;

  const sessions = require(modulePath) as {
    upsertSession(current: unknown, session: unknown, updatedAt: number): unknown;
  };
  const now = 1_800_000_000_000;
  const local = sessions.upsertSession({}, {
    appOrigin: "http://127.0.0.1:3000",
    token: "local-token",
    expiresAt: now + 60_000
  }, now);
  const both = sessions.upsertSession(local, {
    appOrigin: "https://xhstw.qycm.top",
    token: "production-token",
    expiresAt: now + 60_000
  }, now + 1);

  assert.deepEqual(both, {
    "http://127.0.0.1:3000": {
      appOrigin: "http://127.0.0.1:3000",
      token: "local-token",
      expiresAt: now + 60_000,
      updatedAt: now
    },
    "https://xhstw.qycm.top": {
      appOrigin: "https://xhstw.qycm.top",
      token: "production-token",
      expiresAt: now + 60_000,
      updatedAt: now + 1
    }
  });
});

test("selects the session for an open workbench and prefers production when both are open", () => {
  assert.equal(existsSync(modulePath), true, "library2 session selector must exist");
  if (!existsSync(modulePath)) return;

  const sessions = require(modulePath) as {
    selectSession(current: unknown, openOrigins: string[], now: number): { appOrigin: string; token: string } | null;
  };
  const now = 1_800_000_000_000;
  const current = {
    "http://127.0.0.1:3000": { appOrigin: "http://127.0.0.1:3000", token: "local", expiresAt: now + 60_000, updatedAt: now },
    "https://xhstw.qycm.top": { appOrigin: "https://xhstw.qycm.top", token: "production", expiresAt: now + 60_000, updatedAt: now + 1 }
  };

  assert.equal(sessions.selectSession(current, ["https://xhstw.qycm.top"], now)?.token, "production");
  assert.equal(sessions.selectSession(current, ["https://xhstw.qycm.top", "http://127.0.0.1:3000"], now)?.token, "production");
  assert.equal(sessions.selectSession(current, [], now)?.token, "production");
});
