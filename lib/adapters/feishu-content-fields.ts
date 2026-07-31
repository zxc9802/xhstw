export type FeishuFieldMap = ReadonlyMap<string, number>;

const TITLE_FIELD_NAMES = ["标题", "内容标题"] as const;
const ATTACHMENT_FIELD_NAMES = ["图片或视频", "图片", "平台图片"] as const;
const TAG_FIELD_NAMES = ["小红书tag", "关键词", "关键字", "标签"] as const;
const ATTACHMENT_FIELD_TYPE = 17;
const MULTI_SELECT_FIELD_TYPE = 4;

function firstMatchingField(
  fields: FeishuFieldMap,
  names: readonly string[],
  requiredType?: number
) {
  return names.find((name) => fields.has(name)
    && (requiredType === undefined || fields.get(name) === requiredType));
}

export function resolveFeishuContentFieldNames(fields: FeishuFieldMap) {
  return {
    titleFieldName: firstMatchingField(fields, TITLE_FIELD_NAMES),
    attachmentFieldName: firstMatchingField(fields, ATTACHMENT_FIELD_NAMES, ATTACHMENT_FIELD_TYPE),
    tagFieldName: firstMatchingField(fields, TAG_FIELD_NAMES)
  };
}

export function resolveFeishuTagFieldValue(
  fields: FeishuFieldMap,
  fieldName: string | undefined,
  tags: string[]
) {
  if (!fieldName) return "";
  const normalizedTags = Array.from(new Set(tags
    .map((tag) => tag.trim().replace(/^#+/, ""))
    .filter(Boolean)));
  if (fields.get(fieldName) === MULTI_SELECT_FIELD_TYPE) return normalizedTags;
  return normalizedTags.map((tag) => `#${tag}`).join(" ");
}
