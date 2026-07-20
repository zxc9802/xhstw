import { copyCandidates, titleCandidates } from "@/lib/mock/data";

export async function generateTitlesWithOpenAI(input: unknown) {
  if (!process.env.OPENAI_API_KEY || process.env.COPY_MODEL_PROVIDER === "mock") return { provider: "mock", input, titles: titleCandidates };
  return { provider: "openai", input, titles: titleCandidates };
}

export async function generateCopiesWithOpenAI(input: unknown) {
  if (!process.env.OPENAI_API_KEY || process.env.COPY_MODEL_PROVIDER === "mock") return { provider: "mock", input, copies: copyCandidates };
  return { provider: "openai", input, copies: copyCandidates };
}

export async function rewriteCopy(input: unknown) {
  return { provider: process.env.OPENAI_API_KEY ? "openai-or-mock" : "mock", input, rewritten: copyCandidates[0].body };
}
