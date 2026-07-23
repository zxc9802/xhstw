export function buildFeishuBaseUrl(appToken: string, tableId: string) {
  return `https://feishu.cn/base/${encodeURIComponent(appToken)}?table=${encodeURIComponent(tableId)}`;
}
