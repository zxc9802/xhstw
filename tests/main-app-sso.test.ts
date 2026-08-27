import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  createMainAppSessionCookie,
  exchangeMainAppSsoTicket,
  getMainAppSessionCookieOptions,
  readMainAppSessionCookie,
  resolveMainAppSession,
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
  assert.match(callback, /getPublicXhstwAppUrl/);
  assert.match(helper, /https:\/\/xhstw\.qycm\.top/);
  assert.match(helper, /x-qycm-sso-client-secret/);
  assert.match(helper, /httpOnly:\s*true/);
  assert.match(helper, /secure:\s*true/);
  assert.match(helper, /sameSite:\s*["']lax["']/);
  assert.match(middleware, /validateMainAppSession/);
  assert.match(middleware, /api\/sso\/callback/);
  assert.match(middleware, /isMainAppSsoDisabled/);
  assert.match(middleware, /api\/library2/);
});

test("offline mode supplies a local session without an SSO cookie", async () => {
  const previous = process.env.DISABLE_SSO;
  process.env.DISABLE_SSO = "true";
  try {
    const session = await resolveMainAppSession();
    assert.equal(session?.user.id, "local-dev");
    assert.equal(session?.user.account, "local@localhost");
    assert.equal(session?.user.role, "admin");
    assert.equal(await readMainAppSessionCookie(undefined), null);
  } finally {
    if (previous === undefined) delete process.env.DISABLE_SSO;
    else process.env.DISABLE_SSO = previous;
  }
});

test("keeps the child session until the main-issued token expires", async (t) => {
  process.env.APP_SESSION_SECRET = "xhstw-test-session-secret";
  process.env.MAIN_APP_SSO_CLIENT_SECRET = "xhstw-client-secret";
  const expiresAt = Date.now() + (7 * 24 * 60 * 60 * 1000);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    success: true,
    data: {
      token: "main-token",
      redirectPath: "/topics",
      expiresAt,
      user: { id: "user-1", account: "member@example.com", nickname: "成员", role: "member" }
    }
  }), { status: 200 });
  t.after(() => { globalThis.fetch = originalFetch; });

  const { session } = await exchangeMainAppSsoTicket("ticket-1");

  assert.equal(session.expiresAt, expiresAt);
  assert.ok(getMainAppSessionCookieOptions(session.expiresAt).maxAge > 6 * 24 * 60 * 60);
});
