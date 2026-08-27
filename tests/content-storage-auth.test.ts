import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { createMainAppSessionCookie, getMainAppSessionCookieName } from "../lib/main-app-sso";
import { requireContentStorageOwner } from "../lib/content-storage/auth";

test("uses only the encrypted SSO session user id as the COS owner", async () => {
  const previous = process.env.APP_SESSION_SECRET;
  process.env.APP_SESSION_SECRET = "content-storage-auth-test";
  try {
    const cookie = await createMainAppSessionCookie({
      token: "token",
      user: { id: "member-a", account: "a@example.com", nickname: "A", role: "member" },
      expiresAt: Date.now() + 60_000
    });
    const request = new NextRequest("https://app.test/api/content-storage/items?ownerId=member-b", {
      headers: { Cookie: `${getMainAppSessionCookieName()}=${cookie}` }
    });
    assert.equal(await requireContentStorageOwner(request), "member-a");
    await assert.rejects(
      () => requireContentStorageOwner(new NextRequest("https://app.test/api/content-storage/items")),
      /登录/
    );
  } finally {
    if (previous === undefined) delete process.env.APP_SESSION_SECRET;
    else process.env.APP_SESSION_SECRET = previous;
  }
});

test("offline mode uses the local developer as the COS owner", async () => {
  const previous = process.env.DISABLE_SSO;
  process.env.DISABLE_SSO = "true";
  try {
    assert.equal(
      await requireContentStorageOwner(new NextRequest("https://app.test/api/content-storage/items")),
      "local-dev"
    );
  } finally {
    if (previous === undefined) delete process.env.DISABLE_SSO;
    else process.env.DISABLE_SSO = previous;
  }
});
