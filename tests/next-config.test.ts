import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const nextConfig = require("../next.config.js") as {
  serverExternalPackages?: string[];
};

test("keeps OpenCLI and ws out of the Next.js server bundle", () => {
  assert.deepEqual(nextConfig.serverExternalPackages, [
    "@jackwener/opencli",
    "ws"
  ]);
});
