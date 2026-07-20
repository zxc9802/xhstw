import { saveProject } from "@/lib/adapters/local-storage";
import { ok, readJson } from "@/lib/utils/api";

export async function POST(request: Request) {
  return ok(await saveProject(await readJson(request)));
}
