import { rewriteCopy } from "@/lib/adapters/openai-copy";
import { ok, readJson } from "@/lib/utils/api";

export async function POST(request: Request) {
  return ok(await rewriteCopy(await readJson(request)));
}
