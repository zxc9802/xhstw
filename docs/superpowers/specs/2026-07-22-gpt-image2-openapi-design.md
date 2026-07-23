# GPT Image 2 OpenAPI 接口迁移设计

## 目标

将页面中的 `Image 2.0` 文生图能力从原 OpenAI 兼容接口完整切换到新的 `POST /openApi/generate` 接口，同时保持现有页面、异步图片任务和生成结果结构不变。

## 接口配置

适配器从环境变量读取配置，不在源码或日志中保存密钥：

- `GPT_IMAGE2_API_URL`：默认 `http://14.103.147.238:19220/openApi/generate`
- `GPT_IMAGE2_QUERY_URL`：默认由生成地址推导为 `/openApi/queryResult`
- `GPT_IMAGE2_PROJECT_CODE`
- `GPT_IMAGE2_ACCESS_KEY`
- `GPT_IMAGE2_SECRET_KEY`
- `GPT_IMAGE2_MODEL_ID`：默认 `gpt-image2-low`
- `GPT_IMAGE2_RESOLUTION`：默认 `1K`
- `GPT_IMAGE2_POLL_INTERVAL_MS`：默认 `3000`
- `GPT_IMAGE2_POLL_MAX_ATTEMPTS`：默认 `100`

保留 `IMAGE_MODEL_PROVIDER=mock` 的现有本地模拟行为。缺少项目编码或任一密钥时继续返回模拟图片，避免未配置环境无法启动。

## 请求映射

每张图片发送一次 JSON 请求：

```json
{
  "modelId": "gpt-image2-low",
  "abilityType": "IMAGE",
  "prompt": "完整提示词",
  "payload": {
    "params": {
      "resolution": "1K",
      "scale": "1:1"
    }
  }
}
```

请求头固定为 `Content-Type: application/json`、`projectCode`、`X-Access-Key` 和 `X-Secret-Key`。页面现有比例会映射为 `1:1`、`3:4`、`4:3`、`9:16` 或 `16:9`。一次生成多张图片时发送对应数量的独立请求，并沿用现有并发上限；不因响应中缺少图片而自动重复请求，避免意外重复计费。

## 响应与错误处理

- HTTP 非成功状态直接报错。
- 即使 HTTP 为 `200`，只要返回 `success: false`，也使用 `msg`、`message` 或 `error` 作为业务错误。
- 图片结果兼容 URL、data URL 和常见 base64 字段，并在 `data`、`images`、`result`、`output` 等常见容器中有限深度查找。
- 如果成功响应中仍未找到图片，保留脱敏后的原始响应供现有诊断日志定位，页面显示“未解析到图片”的现有错误。
- 如果生成响应只返回 `taskId`，每隔固定时间调用 `POST /openApi/queryResult`，请求体为 `{ "taskId": "...", "abilityType": "IMAGE" }`。状态 `0/1` 继续等待，`2` 从 `message`、`resourceUrls` 或 `content` 提取图片，`3/4` 返回服务商原因，超过限定次数后停止。

当前出口 IP 尚未加入服务白名单，因此真实成功响应结构需在白名单开放后复测校准。

## 参考图行为

新协议未提供参考图或图片编辑参数。只要请求包含 `sourceImageUrls`，适配器就在发起网络请求前明确报错，提示该接口当前只支持文生图；不得忽略参考图后生成一张无关图片，也不得回退到旧接口。

## 修改范围

- `lib/adapters/openai-image.ts`：替换请求、鉴权、比例映射和响应解析。
- `.env.example`：加入新接口配置并移除旧 GPT Image 2 配置。
- `tests/openapi-image.test.ts`：覆盖请求结构、鉴权头、业务失败、结果解析、批量请求和参考图拒绝。

不修改页面交互、异步任务 API、Nano Banana 适配器和图片保存流程。

## 验证

1. 先编写新接口测试并确认在旧实现上失败。
2. 完成最小实现，使新测试和完整测试通过。
3. 运行生产构建与 TypeScript 检查。
4. 白名单开放后，用一张 `1K`、`1:1` 图片做真实复测并按实际成功响应微调解析器。
