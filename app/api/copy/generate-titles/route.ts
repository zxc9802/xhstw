import { generateTitlesWithDeepSeek } from "@/lib/adapters/deepseek";
import { generateTitlesWithOpenAI } from "@/lib/adapters/openai-copy";
import { ok, readJson } from "@/lib/utils/api";

export async function POST(request: Request) {
  const body = await readJson(request);
  const provider = process.env.COPY_MODEL_PROVIDER;
  return ok(provider === "openai" ? await generateTitlesWithOpenAI(body) : await generateTitlesWithDeepSeek(body));
}
