import { checkDuplicate } from "@/lib/adapters/duplicate-checker";
import { ok, readJson } from "@/lib/utils/api";

export async function POST(request: Request) {
  return ok(await checkDuplicate(await readJson(request)));
}
