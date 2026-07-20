import { videoScriptRows, videoShots } from "@/lib/mock/data";

type Message = {
  role: "system" | "user";
  content: string;
};

const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const OPENAI_SCRIPT_MODEL = process.env.OPENAI_SCRIPT_MODEL || "gpt-4.1-mini";

function wantsGpt(input: unknown) {
  return Boolean(input && typeof input === "object" && /gpt|openai/i.test(String((input as Record<string, unknown>).provider ?? "")));
}

function extractJsonObject(text: string) {
  const direct = text.trim();
  if (direct.startsWith("{") && direct.endsWith("}")) return direct;
  const match = direct.match(/\{[\s\S]*\}/);
  return match?.[0] ?? direct;
}

async function requestOpenAI(messages: Message[]) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("缺少 OPENAI_API_KEY");

  const response = await fetch(`${OPENAI_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: OPENAI_SCRIPT_MODEL,
      messages,
      temperature: 0.7,
      response_format: { type: "json_object" }
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data?.error?.message === "string" ? data.error.message : `OpenAI 请求失败：${response.status}`;
    throw new Error(message);
  }

  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("OpenAI 未返回有效内容");
  return JSON.parse(extractJsonObject(content)) as Record<string, unknown>;
}

function normalizeScriptRows(rows: unknown) {
  if (!Array.isArray(rows)) return videoScriptRows;
  return rows.slice(0, 12).map((item, index) => {
    const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const fallback = videoScriptRows[index % videoScriptRows.length];
    return {
      id: String(record.id || `s${index + 1}`),
      time: String(record.time || fallback.time),
      scene: String(record.scene || record["画面描述"] || fallback.scene),
      action: String(record.action || record["人物动作"] || fallback.action),
      audio: String(record.audio || record["音效"] || fallback.audio),
      voiceover: String(record.voiceover || record["口播"] || fallback.voiceover),
      selected: typeof record.selected === "boolean" ? record.selected : true
    };
  });
}

export async function parseVideo(input: unknown) {
  if (!wantsGpt(input) || !process.env.OPENAI_API_KEY) {
    return { provider: process.env.OPENAI_API_KEY ? "gpt-ready-mock" : "mock", input, script: videoScriptRows };
  }

  try {
    const result = await requestOpenAI([
      { role: "system", content: "你是短视频脚本拆解专家。只返回 JSON，不要 Markdown。" },
      {
        role: "user",
        content: [
          "请根据参考视频信息拆解出完整脚本表格。",
          "字段必须包含：time, scene, action, audio, voiceover, selected。",
          "返回 JSON：{\"script\":[{\"id\":\"s1\",\"time\":\"00:00-00:03\",\"scene\":\"...\",\"action\":\"...\",\"audio\":\"...\",\"voiceover\":\"...\",\"selected\":true}]}",
          `输入：${JSON.stringify(input)}`
        ].join("\n")
      }
    ]);
    return { provider: "gpt", model: OPENAI_SCRIPT_MODEL, input, script: normalizeScriptRows(result.script) };
  } catch (error) {
    return { provider: "mock-fallback", error: error instanceof Error ? error.message : "GPT 脚本拆解失败", input, script: videoScriptRows };
  }
}

export async function generateVideoScript(input: unknown) {
  if (!wantsGpt(input) || !process.env.OPENAI_API_KEY) {
    return { provider: process.env.OPENAI_API_KEY ? "gpt-ready-mock" : "mock", input, script: videoScriptRows };
  }

  try {
    const result = await requestOpenAI([
      { role: "system", content: "你是短视频脚本仿写专家。只返回 JSON，不要 Markdown。" },
      {
        role: "user",
        content: [
          "请基于标题、口播方向、提示词和参考图说明，仿写一版新的完整短视频脚本。",
          "字段必须包含：time, scene, action, audio, voiceover, selected。",
          "要求：不是照抄；节奏适合短视频；保留真实分享感；避免夸大功效。",
          "返回 JSON：{\"script\":[{\"id\":\"s1\",\"time\":\"00:00-00:03\",\"scene\":\"...\",\"action\":\"...\",\"audio\":\"...\",\"voiceover\":\"...\",\"selected\":true}]}",
          `输入：${JSON.stringify(input)}`
        ].join("\n")
      }
    ]);
    return { provider: "gpt", model: OPENAI_SCRIPT_MODEL, input, script: normalizeScriptRows(result.script) };
  } catch (error) {
    return { provider: "mock-fallback", error: error instanceof Error ? error.message : "GPT 脚本仿写失败", input, script: videoScriptRows };
  }
}

export async function generateShots(input: unknown) {
  return { provider: process.env.SEEDANCE_API_KEY ? "seedance-or-mock" : "mock", input, shots: videoShots };
}

export async function generateSelectedShots(input: unknown) {
  const selected = videoShots.filter((shot) => shot.selected);
  return { provider: process.env.SEEDANCE_API_KEY ? "seedance-or-mock" : "mock", input, selectedCount: selected.length, shots: selected };
}
