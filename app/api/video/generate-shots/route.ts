import { generateShots } from "@/lib/adapters/seedance";
import { ok, readJson } from "@/lib/utils/api";

export async function POST(request: Request) {
  return ok(await generateShots(await readJson(request)));
}
