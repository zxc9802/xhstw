# TikTok 视频工作流实施计划

**目标：**在现有工作台提供真实数据采集入口、确定性筛选、文字拆解/改写/拍摄脚本及导出，明确服务依赖。

**架构：**独立 `lib/tiktok` 处理契约、导入筛选、TikHub 适配和创作请求；页面访问独立 API；模型复用已有 DeepSeek 请求及计费。

1. [x] `tests/tiktok-videos.test.ts` 先覆盖过滤边界、缺失数据、精确 ID 和 CSV/JSON；观察失败，再实现 `lib/tiktok/videos.ts`。
2. [x] `tests/tiktok-provider.test.ts` 覆盖 HTTP/业务错误、身份绑定、地区核验、分页和缺配置；观察失败，再实现 `lib/tiktok/provider.ts` 与采集 API。
3. [x] `tests/tiktok-production.test.ts` 覆盖文字依据、空资料、结构、语言和缺配置；观察失败，再实现 `lib/tiktok/production.ts`，复用 `lib/adapters/deepseek.ts` 并新增创作 API。
4. [x] 新增 `app/tiktok/page.tsx`、工作区组件、导航、JSON/CSV 模板和配置/边界文档，沿用现有样式。
5. [x] 执行定向测试、TypeScript 检查、全量 `npm.cmd test`、生产构建和浏览器交互核验。仅在失败或新改动后重复对应检查。

本任务在当前会话执行，修改仅限以上范围。无远程发布请求，不上传或推送。

验收结果：TikTok 20 个测试、全量 391 个测试、应用源码类型检查与生产构建通过。浏览器验证导入三种筛选状态、倍数切换、JSON 导出、本地模型生成全包、Markdown 连续分镜导出、刷新恢复及删除确认/取消。验收样本、测试模型和临时下载已清理。未验证真实 TikHub/DeepSeek 服务，因当前未配置密钥。全量独立 tsc 仍报告原有测试文件类型错误，未修改这些旧测试。
