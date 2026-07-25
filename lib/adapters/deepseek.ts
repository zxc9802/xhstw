import { copyCandidates } from "@/lib/mock/data";
import { providerOrMock } from "@/lib/utils/env";

type DeepSeekMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type DeepSeekTitle = {
  title: string;
  score: number;
  tag: string;
};

type DeepSeekCopy = {
  id: string;
  style: string;
  summary: string;
  body: string;
};

const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";

function getReference(input: unknown) {
  if (!input || typeof input !== "object") return {};
  const record = input as Record<string, unknown>;
  return record.reference && typeof record.reference === "object" ? record.reference as Record<string, unknown> : {};
}

function getKeywords(input: unknown) {
  if (!input || typeof input !== "object") return [];
  const record = input as Record<string, unknown>;
  return Array.isArray(record.keywords)
    ? record.keywords.map((item) => String(item).trim()).filter(Boolean)
    : [];
}

function getTextField(input: unknown, field: string) {
  if (!input || typeof input !== "object") return "";
  const record = input as Record<string, unknown>;
  return typeof record[field] === "string" ? String(record[field]).trim() : "";
}

function extractJsonObject(text: string) {
  const direct = text.trim();
  if (direct.startsWith("{") && direct.endsWith("}")) return direct;
  const match = direct.match(/\{[\s\S]*\}/);
  return match?.[0] ?? direct;
}

function pickArray(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key];
  }
  return [];
}

async function requestDeepSeek(messages: DeepSeekMessage[]) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("缺少 DEEPSEEK_API_KEY");

  const response = await fetch(`${DEEPSEEK_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages,
      temperature: 0.85,
      response_format: { type: "json_object" }
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data?.error?.message === "string" ? data.error.message : `DeepSeek 请求失败：${response.status}`;
    throw new Error(message);
  }

  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("DeepSeek 未返回有效内容");
  return JSON.parse(extractJsonObject(content)) as Record<string, unknown>;
}

function shouldUseMock() {
  const provider = providerOrMock(process.env.COPY_MODEL_PROVIDER);
  return provider === "mock" || !process.env.DEEPSEEK_API_KEY;
}

function fallbackTitlesFromReference(title: string) {
  const sourceTitle = title.trim() || "参考作品";
  const tags = ["高点击", "强痛点", "收藏向", "种草向", "科普向", "素人感", "备忘录风", "真实分享", "轻吐槽", "避坑提醒"];
  const patterns = [
    `${sourceTitle}，换个角度这样写更容易被点开`,
    `别只看${sourceTitle}，真正要注意的是这几点`,
    `${sourceTitle}的实用版整理，先收藏再慢慢看`,
    `普通人也能看懂的${sourceTitle}避坑清单`,
    `${sourceTitle}到底怎么选？这篇讲清楚`,
    `关于${sourceTitle}，很多人第一步就做错了`,
    `${sourceTitle}真实使用感：舒服比夸张更重要`,
    `把${sourceTitle}整理成备忘录，照着看就行`,
    `${sourceTitle}不踩雷指南，适合直接参考`,
    `${sourceTitle}的关键不是跟风，而是看场景`
  ];

  return patterns.map((nextTitle, index) => ({
    title: nextTitle,
    score: Math.max(86, 96 - index),
    tag: tags[index]
  }));
}

export async function generateTitlesWithDeepSeek(input: unknown) {
  const reference = getReference(input);
  const title = String(reference.title ?? "");
  const copy = String(reference.copy ?? "");
  const platform = String(reference.platform ?? "小红书");
  const keywords = getKeywords(input);
  const product = getTextField(input, "product");
  const prompt = getTextField(input, "prompt");

  if (shouldUseMock()) return { provider: "mock", input, titles: fallbackTitlesFromReference(title) };

  try {
    const result = await requestDeepSeek([
      {
        role: "system",
        content: "你是小红书内容生产中台的资深中文文案策划。只返回 JSON，不要输出 Markdown。"
      },
      {
        role: "user",
        content: [
          "请基于参考作品仿写 10 条标题候选。",
          "要求：不是照抄，要保留参考作品的真实主题、场景、人物/地点/产品逻辑，重写表达；不要擅自改成防晒、护肤或其他无关主题；适合小红书图文或短视频表达；避免绝对化功效承诺。",
          "返回 JSON 格式：{\"titles\":[{\"title\":\"...\",\"score\":96,\"tag\":\"高点击\"}]}。",
          keywords.length ? `用户指定关键词：${keywords.join("、")}` : "用户指定关键词：无",
          keywords.length ? "标题需要自然围绕这些关键词，但不要生硬堆砌。" : "",
          product ? `产品资料库（唯一产品事实来源）：${product}` : "产品资料库：未选择",
          product ? "只可使用上述产品资料库中的产品名称、分类、卖点、痛点和补充要求；参考作品中的品牌、产品名、品类、卖点和功效不得保留或改写后沿用。" : "",
          prompt ? `额外提示词：${prompt}` : "额外提示词：无",
          `来源平台：${platform}`,
          `参考标题：${title}`,
          `参考正文：${copy}`
        ].join("\n")
      }
    ]);

    const titleRows = pickArray(result, ["titles", "titleCandidates", "candidates", "标题候选", "标题"]);
    const fallbackRows = fallbackTitlesFromReference(title);
    const titles = titleRows.length ? titleRows.slice(0, 10).map((item, index) => {
      const record = item && typeof item === "object" ? item as Partial<DeepSeekTitle> : {};
      return {
        title: String(record.title || (typeof item === "string" ? item : "") || fallbackRows[index % fallbackRows.length].title),
        score: Number(record.score || Math.max(80, 96 - index)),
        tag: String(record.tag || fallbackRows[index % fallbackRows.length].tag)
      };
    }) : fallbackRows;

    return { provider: "deepseek", model: DEEPSEEK_MODEL, input, titles };
  } catch (error) {
    return {
      provider: "mock-fallback",
      model: DEEPSEEK_MODEL,
      error: error instanceof Error ? error.message : "DeepSeek 标题生成失败",
      input,
      titles: fallbackTitlesFromReference(title)
    };
  }
}

export async function generateCopiesWithDeepSeek(input: unknown) {
  if (shouldUseMock()) return { provider: "mock", input, copies: copyCandidates };

  const reference = getReference(input);
  const title = String(reference.title ?? "");
  const copy = String(reference.copy ?? "");
  const platform = String(reference.platform ?? "小红书");
  const keywords = getKeywords(input);
  const product = getTextField(input, "product");
  const prompt = getTextField(input, "prompt");

  try {
    const result = await requestDeepSeek([
      {
        role: "system",
        content: "你是小红书内容生产中台的资深中文文案策划。只返回 JSON，不要输出 Markdown。"
      },
      {
        role: "user",
        content: [
          "请基于参考作品仿写 10 条文案候选。",
          "重要：这里只生成正文文案，不要生成标题，不要把标题式短句放进 summary 或 body。",
          "要求：每条文案风格不同；不是照抄；必须保留参考作品的真实主题、场景、人物/地点/产品逻辑；不要擅自改成防晒、护肤或其他无关主题；保留收藏点、评论引导；避免虚假承诺和绝对化表达；适合本地内容生产后人工审核。",
          "每条 body 必须是完整正文，建议 220-600 个中文字；summary 必须是正文摘要，40-90 个中文字，不能像标题。",
          "返回 JSON 格式：{\"copies\":[{\"id\":\"A1\",\"style\":\"素人种草\",\"summary\":\"正文摘要...\",\"body\":\"完整正文...\"}]}。",
          keywords.length ? `用户指定关键词：${keywords.join("、")}` : "用户指定关键词：无",
          keywords.length ? "正文需要自然覆盖这些关键词，并保留小红书口吻。" : "",
          product ? `产品资料库（唯一产品事实来源）：${product}` : "产品资料库：未选择",
          product ? "只可使用上述产品资料库中的产品名称、分类、卖点、痛点和补充要求；参考作品中的品牌、产品名、品类、卖点和功效不得保留或改写后沿用。" : "",
          prompt ? `额外提示词：${prompt}` : "额外提示词：无",
          `来源平台：${platform}`,
          `参考标题：${title}`,
          `参考正文：${copy}`
        ].join("\n")
      }
    ]);

    const copies = Array.isArray(result.copies) ? result.copies.slice(0, 10).map((item, index) => {
      const record = item && typeof item === "object" ? item as Partial<DeepSeekCopy> : {};
      const fallback = copyCandidates[index % copyCandidates.length];
      const body = String(record.body || fallback.body);
      return {
        id: String(record.id || `A${index + 1}`),
        style: String(record.style || fallback.style),
        summary: String(record.summary || body.slice(0, 80) || fallback.summary),
        body
      };
    }) : copyCandidates;

    return { provider: "deepseek", model: DEEPSEEK_MODEL, input, copies };
  } catch (error) {
    return {
      provider: "mock-fallback",
      model: DEEPSEEK_MODEL,
      error: error instanceof Error ? error.message : "DeepSeek 文案生成失败",
      input,
      copies: copyCandidates
    };
  }
}
