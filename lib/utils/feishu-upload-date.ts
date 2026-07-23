export function getFeishuUploadDateValue(fields: ReadonlyMap<string, number>, uploadedAt: number) {
  return fields.get("上传日期") === 5 ? uploadedAt : "";
}
