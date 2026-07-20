import { regenerateSingleImage } from "@/lib/adapters/openai-image";
import { ok, readJson } from "@/lib/utils/api";

export async function POST(request: Request) {
  return ok(await regenerateSingleImage(await readJson(request)));
}
