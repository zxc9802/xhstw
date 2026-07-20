import { uploadReferenceText } from "@/lib/adapters/reference-parser";
import { ok, readJson } from "@/lib/utils/api";

export async function POST(request: Request) {
  return ok(await uploadReferenceText(await readJson(request)));
}
