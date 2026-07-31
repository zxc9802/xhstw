import { copyCandidates } from "@/lib/mock/data";
import { providerOrMock } from "@/lib/utils/env";
import {
  MainAppBillingError,
  parseOpenAiUsage,
  reserveMainAppCredits,
} from "@/lib/main-app-billing";

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

async function requestDeepSeek(messages: DeepSeekMessage[], temperature = 0.85) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("缺少 DEEPSEEK_API_KEY");

  const maxOutputTokens = 4096;
  const estimatedInputTokens = new TextEncoder().encode(JSON.stringify(messages)).length;
  const billing = await reserveMainAppCredits({
    operation: "copy",
    providerId: "deepseek",
    model: DEEPSEEK_MODEL,
    estimatedInputTokens,
    maxOutputTokens,
  });
  try {
    const response = await fetch(`${DEEPSEEK_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages,
        temperature,
        response_format: { type: "json_object" },
        max_tokens: maxOutputTokens,
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = typeof data?.error?.message === "string" ? data.error.message : `DeepSeek 请求失败：${response.status}`;
      throw new Error(message);
    }

    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw new Error("DeepSeek 未返回有效内容");
    await billing.settleText(parseOpenAiUsage(data, {
      inputTokens: estimatedInputTokens,
      outputText: content,
    }));
    return JSON.parse(extractJsonObject(content)) as Record<string, unknown>;
  } catch (error) {
    if (error instanceof MainAppBillingError) throw error;
    await billing.release();
    throw error;
  }
}

function requiresNoChinese(prompt: string) {
  return /不(?:要|得|能|可).{0,8}中文|无中文|禁(?:止|用)中文|只(?:要|用|写|输出).{0,4}(?:英文|英语)|(?:english|non-chinese)\s+only|no\s+chinese/iu.test(prompt);
}

function containsChinese(value: unknown) {
  return /[\u3400-\u9fff]/u.test(JSON.stringify(value));
}

async function requestLanguageCompliantJson(
  messages: DeepSeekMessage[],
  noChinese: boolean,
  hasExpectedRows: (result: Record<string, unknown>) => boolean
) {
  const firstResult = await requestDeepSeek(messages, noChinese ? 0.65 : 0.85);
  if (!noChinese || (hasExpectedRows(firstResult) && !containsChinese(firstResult))) return firstResult;

  const correctedResult = await requestDeepSeek([
    ...messages,
    { role: "assistant", content: JSON.stringify(firstResult) },
    {
      role: "user",
      content: "上一版违反了硬性语言要求。请重新返回完整 JSON：所有可见文本字段不得包含任何中文汉字，只能使用自然英文；不要解释。"
    }
  ], 0.2);
  if (!hasExpectedRows(correctedResult) || containsChinese(correctedResult)) {
    throw new Error("DeepSeek 连续两次未遵守“不要中文”的硬性要求");
  }
  return correctedResult;
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

function fallbackEnglishTitles() {
  const patterns = [
    "An Honest Everyday Review",
    "What I Wish I Knew Before Trying It",
    "A Simple Real-Life Guide",
    "The Details That Actually Matter",
    "My Unfiltered Experience",
    "A Practical Checklist for Beginners",
    "What Worked for Me in Daily Life",
    "A Calm Review Without the Hype",
    "The Small Things Worth Noticing",
    "A Straightforward Use-Case Breakdown"
  ];
  return patterns.map((title, index) => ({
    title,
    score: Math.max(86, 96 - index),
    tag: "Natural voice"
  }));
}

function fallbackEnglishCopies() {
  return Array.from({ length: 10 }, (_, index) => ({
    id: `A${index + 1}`,
    style: "Natural diary",
    summary: "A concise, honest summary based on an everyday use case.",
    body: "This version keeps the tone natural and personal, focuses on a realistic everyday experience, and avoids exaggerated claims. It is intended as a clean draft for further human review."
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
  const noChinese = requiresNoChinese(prompt);

  if (shouldUseMock()) return { provider: "mock", input, titles: noChinese ? fallbackEnglishTitles() : fallbackTitlesFromReference(title) };

  try {
    const result = await requestLanguageCompliantJson([
      {
        role: "system",
        content: noChinese
          ? "你是小红书内容生产中台的文案策划。只返回 JSON，不要输出 Markdown。用户要求英文时，所有可见文本字段不得包含任何中文汉字，只能使用自然英文。"
          : "你是小红书内容生产中台的资深中文文案策划。只返回 JSON，不要输出 Markdown。"
      },
      {
        role: "user",
        content: [
          "请基于参考作品仿写 10 条标题候选。",
          "要求：不是照抄，要保留参考作品的真实主题、场景、人物/地点/产品逻辑，重写表达；不要擅自改成防晒、护肤或其他无关主题；适合小红书图文或短视频表达；避免绝对化功效承诺。",
          noChinese
            ? "返回 JSON 格式：{\"titles\":[{\"title\":\"...\",\"score\":96,\"tag\":\"Natural voice\"}]}。"
            : "返回 JSON 格式：{\"titles\":[{\"title\":\"...\",\"score\":96,\"tag\":\"高点击\"}]}。",
          keywords.length ? `用户指定关键词：${keywords.join("、")}` : "用户指定关键词：无",
          keywords.length ? "标题需要自然围绕这些关键词，但不要生硬堆砌。" : "",
          product ? `产品资料库（唯一产品事实来源）：${product}` : "产品资料库：未选择",
          product ? "只可使用上述产品资料库中的产品名称、分类、卖点、痛点和补充要求；参考作品中的品牌、产品名、品类、卖点和功效不得保留或改写后沿用。" : "",
          prompt ? `额外提示词：${prompt}` : "额外提示词：无",
          noChinese ? "硬性语言要求（最高优先级）：title 和 tag 不得包含任何中文汉字，只能使用自然英文；参考资料中的中文信息需要翻译或改写成英文。" : "",
          `来源平台：${platform}`,
          `参考标题：${title}`,
          `参考正文：${copy}`
        ].join("\n")
      }
    ], noChinese, (value) => pickArray(value, ["titles", "titleCandidates", "candidates", "标题候选", "标题"])
      .some((item) => Boolean(item && typeof item === "object" && String((item as Partial<DeepSeekTitle>).title ?? "").trim())));

    const titleRows = pickArray(result, ["titles", "titleCandidates", "candidates", "标题候选", "标题"]);
    const fallbackRows = noChinese ? fallbackEnglishTitles() : fallbackTitlesFromReference(title);
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
    if (error instanceof MainAppBillingError) throw error;
    return {
      provider: "mock-fallback",
      model: DEEPSEEK_MODEL,
      error: error instanceof Error ? error.message : "DeepSeek 标题生成失败",
      input,
      titles: noChinese ? fallbackEnglishTitles() : fallbackTitlesFromReference(title)
    };
  }
}

export async function generateCopiesWithDeepSeek(input: unknown) {
  const reference = getReference(input);
  const title = String(reference.title ?? "");
  const copy = String(reference.copy ?? "");
  const platform = String(reference.platform ?? "小红书");
  const keywords = getKeywords(input);
  const product = getTextField(input, "product");
  const prompt = getTextField(input, "prompt");
  const noChinese = requiresNoChinese(prompt);

  if (shouldUseMock()) return { provider: "mock", input, copies: noChinese ? fallbackEnglishCopies() : copyCandidates };

  try {
    const result = await requestLanguageCompliantJson([
      {
        role: "system",
        content: noChinese
          ? "你是小红书内容生产中台的文案策划。只返回 JSON，不要输出 Markdown。用户要求英文时，所有可见文本字段不得包含任何中文汉字，只能使用自然英文。"
          : "你是小红书内容生产中台的资深中文文案策划。只返回 JSON，不要输出 Markdown。"
      },
      {
        role: "user",
        content: [
          "请基于参考作品仿写 10 条文案候选。",
          "重要：这里只生成正文文案，不要生成标题，不要把标题式短句放进 summary 或 body。",
          "要求：每条文案风格不同；不是照抄；必须保留参考作品的真实主题、场景、人物/地点/产品逻辑；不要擅自改成防晒、护肤或其他无关主题；保留收藏点、评论引导；避免虚假承诺和绝对化表达；适合本地内容生产后人工审核。",
          noChinese
            ? "每条 body 必须是完整英文正文，建议 150-450 个英文单词；summary 必须是英文正文摘要，建议 25-60 个英文单词，不能像标题。"
            : "每条 body 必须是完整正文，建议 220-600 个中文字；summary 必须是正文摘要，40-90 个中文字，不能像标题。",
          noChinese
            ? "返回 JSON 格式：{\"copies\":[{\"id\":\"A1\",\"style\":\"Natural diary\",\"summary\":\"Copy summary...\",\"body\":\"Complete copy...\"}]}。"
            : "返回 JSON 格式：{\"copies\":[{\"id\":\"A1\",\"style\":\"素人种草\",\"summary\":\"正文摘要...\",\"body\":\"完整正文...\"}]}。",
          keywords.length ? `用户指定关键词：${keywords.join("、")}` : "用户指定关键词：无",
          keywords.length ? "正文需要自然覆盖这些关键词，并保留小红书口吻。" : "",
          product ? `产品资料库（唯一产品事实来源）：${product}` : "产品资料库：未选择",
          product ? "只可使用上述产品资料库中的产品名称、分类、卖点、痛点和补充要求；参考作品中的品牌、产品名、品类、卖点和功效不得保留或改写后沿用。" : "",
          prompt ? `额外提示词：${prompt}` : "额外提示词：无",
          noChinese ? "硬性语言要求（最高优先级）：style、summary、body 不得包含任何中文汉字，只能使用自然英文；参考资料中的中文信息需要翻译或改写成英文。" : "",
          `来源平台：${platform}`,
          `参考标题：${title}`,
          `参考正文：${copy}`
        ].join("\n")
      }
    ], noChinese, (value) => Array.isArray(value.copies)
      && value.copies.some((item) => Boolean(item && typeof item === "object" && String((item as Partial<DeepSeekCopy>).body ?? "").trim())));

    const copies = Array.isArray(result.copies) ? result.copies.slice(0, 10).map((item, index) => {
      const record = item && typeof item === "object" ? item as Partial<DeepSeekCopy> : {};
      const fallback = noChinese ? fallbackEnglishCopies()[index % 10] : copyCandidates[index % copyCandidates.length];
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
    if (error instanceof MainAppBillingError) throw error;
    return {
      provider: "mock-fallback",
      model: DEEPSEEK_MODEL,
      error: error instanceof Error ? error.message : "DeepSeek 文案生成失败",
      input,
      copies: noChinese ? fallbackEnglishCopies() : copyCandidates
    };
  }
}
