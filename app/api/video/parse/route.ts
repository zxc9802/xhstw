import { parseVideo } from "@/lib/adapters/seedance";
import { ok, readJson } from "@/lib/utils/api";

export async function POST(request: Request) {
  return ok(await parseVideo(await readJson(request)));
}
