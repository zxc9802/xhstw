import { parseReferenceText } from "@/lib/adapters/reference-parser";
import { ok, readJson } from "@/lib/utils/api";

export async function POST(request: Request) {
  return ok(await parseReferenceText(await readJson(request)));
}
