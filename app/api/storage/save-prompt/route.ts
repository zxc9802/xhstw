import { savePrompt } from "@/lib/adapters/local-storage";
import { ok, readJson } from "@/lib/utils/api";

export async function POST(request: Request) {
  return ok(await savePrompt(await readJson(request)));
}
