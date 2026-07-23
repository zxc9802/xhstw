import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  createMainAppSessionCookie,
  readMainAppSessionCookie,
  safeRedirectPath
} from "../lib/main-app-sso";

test("encrypts a host-only target session and rejects invalid cookie input", async () => {
  process.env.APP_SESSION_SECRET = "xhstw-test-session-secret";
  const expiresAt = Date.now() + 60_000;
  const cookie = await createMainAppSessionCookie({
    token: "main-token",
    user: { id: "user-1", account: "member@example.com", nickname: "成员", role: "member" },
    expiresAt
  });

  assert.doesNotMatch(cookie, /main-token/);
  assert.deepEqual(await readMainAppSessionCookie(cookie), {
    token: "main-token",
    user: { id: "user-1", account: "member@example.com", nickname: "成员", role: "member" },
    expiresAt
  });
  assert.equal(await readMainAppSessionCookie("invalid"), null);
  assert.equal(safeRedirectPath("/content?tab=image"), "/content?tab=image");
  assert.equal(safeRedirectPath("//outside.example"), "/");
});

test("callback and middleware keep ticket exchange server-side", async () => {
  const root = path.join(process.cwd());
  const [callback, middleware, helper] = await Promise.all([
    readFile(path.join(root, "app/api/sso/callback/route.ts"), "utf8"),
    readFile(path.join(root, "middleware.ts"), "utf8"),
    readFile(path.join(root, "lib/main-app-sso.ts"), "utf8")
  ]);

  assert.match(callback, /exchangeMainAppSsoTicket/);
  assert.match(helper, /x-qycm-sso-client-secret/);
  assert.match(helper, /httpOnly:\s*true/);
  assert.match(helper, /secure:\s*true/);
  assert.match(helper, /sameSite:\s*["']lax["']/);
  assert.match(middleware, /validateMainAppSession/);
  assert.match(middleware, /api\/sso\/callback/);
});
