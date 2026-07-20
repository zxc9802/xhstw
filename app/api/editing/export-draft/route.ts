import { exportEditingDraft } from "@/lib/adapters/editing-adapter";
import { ok, readJson } from "@/lib/utils/api";

export async function POST(request: Request) {
  return ok(await exportEditingDraft(await readJson(request)));
}
