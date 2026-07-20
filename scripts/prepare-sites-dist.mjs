import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const openNextDir = path.join(root, ".open-next");
const workerEntry = path.join(openNextDir, "worker.js");
const distDir = path.join(root, "dist");
const serverDir = path.join(distDir, "server");

if (!existsSync(workerEntry)) {
  throw new Error("Missing .open-next/worker.js. Run opennextjs-cloudflare build first.");
}

rmSync(distDir, { recursive: true, force: true });
mkdirSync(serverDir, { recursive: true });

cpSync(openNextDir, serverDir, { recursive: true });
cpSync(workerEntry, path.join(serverDir, "index.js"));

const assetsDir = path.join(openNextDir, "assets");
if (existsSync(assetsDir)) {
  cpSync(assetsDir, path.join(distDir, "assets"), { recursive: true });
}
