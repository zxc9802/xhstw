import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("real text and image providers use main-site credit billing", async () => {
  const deepseek = await readFile(new URL("../lib/adapters/deepseek.ts", import.meta.url), "utf8");
  const seedance = await readFile(new URL("../lib/adapters/seedance.ts", import.meta.url), "utf8");
  const nano = await readFile(new URL("../lib/adapters/nano-banana.ts", import.meta.url), "utf8");
  const image = await readFile(new URL("../lib/adapters/openai-image.ts", import.meta.url), "utf8");
  const imageRoute = await readFile(new URL("../app/api/image/generate/route.ts", import.meta.url), "utf8");
  const billing = await readFile(new URL("../lib/main-app-billing.ts", import.meta.url), "utf8");

  assert.match(deepseek, /billing\.settleText\(parseOpenAiUsage/);
  assert.match(seedance, /billing\.settleText\(parseOpenAiUsage/);
  assert.match(nano, /billing\.settleMedia\(\)/);
  assert.match(image, /billing\.settleMedia\(\)/);
  for (const source of [deepseek, seedance, nano, image]) {
    assert.match(source, /instanceof MainAppBillingError/);
  }
  assert.match(billing, /product:\s*"xhstw"/);
  assert.match(billing, /x-qycm-sso-client-secret/);
  assert.match(billing, /billing_config/);
  assert.match(imageRoute, /billingUserId = await currentBillingUserId\(\)/);
  assert.match(imageRoute, /runWithMainAppBillingUser\(billingUserId/);
});
