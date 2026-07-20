import { createEditPlan } from "@/lib/adapters/editing-adapter";
import { ok, readJson } from "@/lib/utils/api";

export async function POST(request: Request) {
  return ok(await createEditPlan(await readJson(request)));
}
