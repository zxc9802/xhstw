# GPT Image 2 当前接口重试与 Yunwu 兜底设计

## 目标

保留当前聚合接口作为 `Image 2.0` 的首选提供方。无论文生图还是图生图，只要当前接口请求出错，均在首次失败后再重试 3 次；4 次尝试全部失败后，自动切换到原 Yunwu `gpt-image-2` 接口。

页面调用方式、异步任务接口、生成历史、图片代理和保存流程保持不变。

## 提供方顺序

每一张待生成图片独立执行以下顺序：

1. 调用当前聚合接口。
2. 失败后重新调用当前聚合接口，最多再试 3 次，即总计最多 4 次。
3. 4 次全部失败后，调用 Yunwu 一次。
4. Yunwu 成功则返回图片；Yunwu 也失败则抛出同时包含当前接口最终错误和 Yunwu 错误的汇总错误。

多张图片仍沿用现有并发上限，并按单张图片分别重试、兜底。已经成功的图片不重新生成，也不因为其他图片失败而整批切换提供方。

## 当前聚合接口请求

文生图保持现有请求体：

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

图生图也先调用当前接口，并把页面传入的参考图地址放入 `payload.resources`：

```json
{
  "modelId": "gpt-image2-low",
  "abilityType": "IMAGE",
  "prompt": "完整提示词",
  "payload": {
    "resources": ["https://example.com/reference.jpg"],
    "params": {
      "resolution": "1K",
      "scale": "1:1"
    }
  }
}
```

聚合接口文档只明确把 `payload.resources` 定义为图片资源列表，没有提供 `IMAGE + gpt-image2-low` 的图生图示例。因此该字段是基于现有公共协议的最小兼容尝试；服务端不接受时会进入相同的 3 次重试和 Yunwu 兜底流程。

## 失败判定

用户要求所有错误都进入重试和兜底，不区分技术错误、参数错误或内容审核错误。以下情况均视为当前接口单次失败：

- 网络连接失败或请求超时；
- HTTP 非成功状态；
- HTTP 成功但响应为 `success: false`；
- 轮询返回失败、取消、未知状态或超时；
- 响应既没有图片，也没有可轮询的 `taskId`；
- 任务完成但没有可解析的图片 URL 或 base64。

每次失败都重新提交一次完整生成请求。轮询过程中的错误也算该次生成失败，并从新的生成请求重新开始。

## Yunwu 兜底格式

文生图调用：

- `POST YUNWU_IMAGE_URL`，默认 `https://yunwu.ai/v1/images/generations`；
- `Content-Type: application/json`；
- `Authorization: Bearer <YUNWU_API_KEY>`；
- JSON 字段包含 `model`、`prompt`、`n: 1`、`size`、`quality: high` 和 `format`。

图生图调用：

- `POST YUNWU_IMAGE_EDIT_URL`，默认 `https://yunwu.ai/v1/images/edits`；
- `Authorization: Bearer <YUNWU_API_KEY>`；
- 使用 `multipart/form-data`；
- 表单字段包含 `model`、`prompt`、`n: 1`、`size`、`quality: high`；
- 每一张参考图下载后以重复的 `image` 文件字段上传。

兜底模型默认为 `gpt-image-2`。Yunwu 返回的 `data[].url`、`data[].b64_json`、`images` 和已有兼容结构继续复用统一图片解析器。

## 环境变量

保留现有聚合接口变量，并恢复以下 Yunwu 图片变量：

- `YUNWU_API_KEY`：Yunwu 鉴权密钥，项目当前已用于 Yunwu 聊天接口；
- `YUNWU_IMAGE_URL`：可选，默认 `https://yunwu.ai/v1/images/generations`；
- `YUNWU_IMAGE_EDIT_URL`：可选，默认 `YUNWU_IMAGE_URL` 对应的 `/images/edits`；
- `OPENAI_IMAGE_MODEL`：可选，默认 `gpt-image-2`；
- `OPENAI_IMAGE_FORMAT`：可选，默认 `jpeg`。

密钥只从服务端环境变量读取，不写入客户端响应、源码或日志。

## 结果兼容

顶层接口仍返回现有 `provider`、`model`、`input` 和 `images` 结构。每张图片保留实际成功提供方信息：

- 当前聚合接口成功：`provider: "Image 2.0"`；
- Yunwu 兜底成功：`provider: "Image 2.0 (Yunwu fallback)"`。

这样不需要修改页面生成流程，同时可以从生成结果判断是否发生过兜底。

## 修改范围

- 修改 `lib/adapters/openai-image.ts`：加入当前接口 4 次尝试、参考图 `payload.resources`、Yunwu 文生图和图生图兜底。
- 修改 `.env.example`：恢复 Yunwu 图片接口变量说明，不加入真实密钥。
- 修改 `tests/openapi-image.test.ts`：覆盖重试次数、文生图兜底、图生图当前接口请求、图生图 Yunwu 兜底、空结果和双提供方失败。

不修改页面组件、异步任务路由、图片代理、Nano Banana 适配器或数据库结构。

## 验收标准

1. 当前接口第一次成功时只调用一次，不调用 Yunwu。
2. 当前接口前 3 次失败、第 4 次成功时总计调用 4 次，不调用 Yunwu。
3. 当前接口 4 次全部失败时，第 5 次请求调用 Yunwu 并返回其图片。
4. 图生图请求会先把全部参考图地址传入当前接口的 `payload.resources`。
5. 图生图当前接口 4 次失败后，以文件形式把参考图上传到 Yunwu `/v1/images/edits`。
6. 空图片且没有 `taskId` 的响应会触发重试，不再被当成成功的空结果。
7. 两个提供方都失败时，页面获得可定位两个失败阶段的错误信息，且不包含密钥。
8. 新增针对性测试、完整测试、TypeScript 检查和生产构建全部通过。
