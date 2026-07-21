export type FeishuFieldMap = ReadonlyMap<string, number>;

const TITLE_FIELD_NAMES = ["标题", "内容标题"] as const;
const ATTACHMENT_FIELD_NAMES = ["图片或视频", "图片", "平台图片"] as const;
const ATTACHMENT_FIELD_TYPE = 17;

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
    attachmentFieldName: firstMatchingField(fields, ATTACHMENT_FIELD_NAMES, ATTACHMENT_FIELD_TYPE)
  };
}
