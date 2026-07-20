import { ok, readJson } from "@/lib/utils/api";

export async function POST(request: Request) {
  return ok({ mode: "mock", endpoint: "import-csv", received: await readJson(request) });
}
