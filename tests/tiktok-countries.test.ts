import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";

test("country labels stay identical across different server and browser Intl data", () => {
  function labels(prefix: string) {
    const script = `Intl.DisplayNames = class { of(code) { return ${JSON.stringify(prefix)} + code; } }; console.log(JSON.stringify(require('./lib/tiktok/countries.ts').countryOptions));`;
    return execFileSync(process.execPath, ["--import", "tsx", "-e", script], { encoding: "utf8", windowsHide: true }).trim();
  }
  assert.ok(labels("server-") === labels("browser-"), "country labels must match across Intl versions to avoid hydration errors");
});
