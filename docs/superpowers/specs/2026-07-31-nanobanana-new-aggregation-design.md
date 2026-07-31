# nanobanan新聚合生图接入设计

## 目标

在不改变现有 `Image 2.0` 和 `Nano Banana 2` 行为的前提下，新增一个前端显示为 `nanobanan新` 的生图通道。该通道使用聚合服务提供的 `gemini-3.1-flash-image-preview` 模型，并支持当前内容生产页面的文生图、参考图生图、全局模型选择和单页模型选择。

## 范围

- 新增独立的聚合生图适配器。
- 在所有现有生图模型选择位置加入 `nanobanan新`。
- 将 `nanobanan新` 请求从现有图片生成作业路由分发到新适配器。
- 复用现有临时参考图发布机制，把本地或 Base64 参考图转换成聚合服务可访问的 URL。
- 增加聚合服务配置示例、自动化测试和必要的错误信息。

不修改现有 `Image 2.0`、`Nano Banana 2`、图片作业客户端协议、数据库结构或页面布局。

## 配置

服务端读取以下环境变量：

- `IMAGE_AGGREGATION_API_BASE_URL`
- `IMAGE_AGGREGATION_PROJECT_CODE`
- `IMAGE_AGGREGATION_ACCESS_KEY`
- `IMAGE_AGGREGATION_SECRET_KEY`
- `NANOBANANA_NEW_MODEL_ID`，默认值为 `gemini-3.1-flash-image-preview`
- `NANOBANANA_NEW_POLL_INTERVAL_MS`，默认值为 `3000`
- `NANOBANANA_NEW_POLL_MAX_ATTEMPTS`，默认值为 `100`

密钥只在服务端使用，不写入客户端代码或响应。用户提供的实际配置写入本地 `.env.local`，公开的 `.env.example` 只保留空值或非敏感默认值。

## 组件设计

### 前端模型类型与选项

`types/image.ts` 的 `ImageProvider` 联合类型新增 `nanobanan新`。`app/content/page.tsx` 使用的统一模型选项数组增加该值，因此全局模型下拉框和每页模型下拉框自动同时显示新选项。

### 图片生成路由

`app/api/image/generate/route.ts` 根据精确的 provider 值分发：

- `nanobanan新` 调用新聚合适配器。
- `Nano Banana 2` 继续调用现有 Nano Banana 适配器。
- 其他 provider 保持现有路由规则。

`nanobanan新` 使用参考图时，路由复用现有 `publishImageReferences`，将本地数据发布为带临时令牌的同源 URL。作业结束后，无论成功还是失败，都删除临时引用。

### 聚合生图适配器

新增 `lib/adapters/nanobanana-new.ts`，职责限定为：

1. 校验所需环境变量。
2. 将当前图片生成输入转换为聚合协议。
3. 调用 `${IMAGE_AGGREGATION_API_BASE_URL}/openApi/generate`。
4. 使用返回的任务 ID 调用 `${IMAGE_AGGREGATION_API_BASE_URL}/openApi/queryResult` 轮询。
5. 将最终图片地址规范化为当前项目的 `{ id, url, provider }[]` 结构。

提交请求使用以下核心结构：

```json
{
  "modelId": "gemini-3.1-flash-image-preview",
  "abilityType": "IMAGE",
  "prompt": "用户提示词",
  "payload": {
    "params": {
      "resolution": "1K",
      "scale": "9:16"
    },
    "resources": ["https://公开可访问的参考图"]
  }
}
```

鉴权头为 `projectCode`、`X-Access-Key`、`X-Secret-Key`。一次页面请求需要多张结果时，适配器按现有 `count` 上限发起独立聚合任务，避免依赖供应商未在仓库协议中明确保证的批量字段。

## 状态和结果解析

适配器接受常见的聚合响应包裹层，并从 `data.taskId`、`data.task_id`、顶层 `taskId` 或 `task_id` 读取任务 ID。查询响应中的成功、失败和处理中状态统一映射：

- 成功：返回找到的图片 URL。
- 失败或取消：抛出带供应商消息的错误。
- 处理中：等待后继续轮询。
- 达到最大轮询次数：抛出超时错误。

图片 URL 从常见的 `imageUrl`、`image_url`、`url`、`images`、`output`、`outputs` 和嵌套 `data` 字段中提取。成功响应没有图片地址时视为失败，不返回空成功结果。

## 错误处理

- 配置缺失：列出缺少的环境变量名称，不包含任何密钥值。
- 提交 HTTP 失败：包含 HTTP 状态和供应商返回的安全错误消息。
- 提交成功但无任务 ID：提示聚合服务未返回任务 ID。
- 查询失败或任务终止：返回供应商错误消息。
- 轮询超时：提示任务超时并建议重试。
- 成功但无图片：提示聚合服务未返回图片地址。

诊断日志复用现有图片响应诊断模块，并遵循已有的脱敏和长度限制。

## 测试策略

按照 TDD 实施，先写并运行失败测试，再写最小实现：

- provider 类型和前端统一选项包含 `nanobanan新`。
- 图片路由将 `nanobanan新` 分发到聚合适配器。
- 本地参考图通过临时同源 URL进入 `payload.resources`，任务结束后被清理。
- 提交请求包含正确模型、参数和鉴权头。
- 查询轮询能把成功结果转换为当前图片结果结构。
- 缺少配置、提交失败、任务失败、无任务 ID、无图片结果和轮询超时均产生明确错误。

完成后运行新适配器测试、图片路由测试、完整测试套件和生产构建，并通过 `git diff --check` 检查变更。

## 成功标准

- 页面所有现有生图模型下拉框都能选择 `nanobanan新`。
- 选择该通道后，请求只使用服务端聚合配置，不暴露密钥。
- 文生图和参考图生图均按聚合协议提交并轮询到最终图片。
- 原有图片模型测试与生产构建继续通过。
- 变更仅覆盖本设计列出的文件和由本次改动新增的测试、文档。
