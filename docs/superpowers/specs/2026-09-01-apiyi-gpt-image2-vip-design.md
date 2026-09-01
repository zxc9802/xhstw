# API易 gpt-image2-vip 独立适配器设计

## 目标

在现有图片生成页面新增一个显示为 `gpt-image2-vip` 的独立模型选项。该选项通过 API易的 `gpt-image-2-vip` 模型支持文生图、单图编辑和多图融合，同时保持现有图片生成作业、结果缓存、COS 保存和其他模型行为不变。

## 范围

- 新增独立的 API易图片适配器。
- 在统一图片模型类型和页面全部模型选择器中加入 `gpt-image2-vip`。
- 将该 provider 从现有图片生成作业路由精确分发到新适配器。
- 支持页面当前的五种图片比例和最多十张并发生成。
- 将真实 API Key 写入被 Git 忽略的 `.env.local`，公开配置只保留空值。
- 增加适配器、路由和页面契约测试，并执行真实文生图与图生图探针。

本次不修改现有 `Image 2.0`、`gpt-image-2-c`、Nano Banana 系列的请求协议，不增加新的页面控件，不实现参考图压缩，也不重构图片作业或存储流程。

## 配置

服务端读取以下环境变量：

- `APIYI_IMAGE_API_KEY`：API易密钥，必填。
- `APIYI_IMAGE_URL`：文生图地址，默认 `https://api.apiyi.com/v1/images/generations`。
- `APIYI_IMAGE_EDIT_URL`：图生图地址，默认 `https://api.apiyi.com/v1/images/edits`。
- `APIYI_IMAGE_MODEL`：上游模型名，默认 `gpt-image-2-vip`。

`.env.example` 记录变量名、空密钥和非敏感默认值；用户提供的真实密钥只写入 `.env.local`。密钥不得进入客户端代码、API 响应、日志、测试夹具或 Git 历史。

## 组件设计

### 页面模型选项

`types/image.ts` 的 `ImageProvider` 联合类型新增 `gpt-image2-vip`。`app/content/page.tsx` 的统一 `imageProviders` 数组加入同名选项，因此全局默认模型和每个 P 页模型下拉框会同时获得该选项。

页面向 `/api/image/generate` 发送的 provider 值固定为 `gpt-image2-vip`；适配器向上游发送的 model 值固定为环境变量解析出的 `gpt-image-2-vip`。这两个名称不可混用。

### 作业路由

`app/api/image/generate/route.ts` 使用精确 provider 判断把 `gpt-image2-vip` 分发给新适配器。参考图保持当前请求中的 data URL 或公开 HTTPS URL，不通过临时公开资源代理，因为新适配器会在服务端下载并作为 multipart 文件上传。

API易和现有直连图片提供方共用公开参考图校验：允许 `data:image/...` 和公开 HTTPS 图片，拒绝 HTTP、本机地址及内网地址。错误消息使用当前模型名称，不把 API易请求误报为 Yunwu 错误。

作业创建、后台执行、计费用户上下文、结果缓存和最终引用清理逻辑保持不变。

### API易适配器

新增 `lib/adapters/apiyi-image.ts`，职责限定为：

1. 在调用时解析并校验 API易配置。
2. 将页面比例映射为 API易支持的 2K Recommended 尺寸。
3. 根据是否有参考图选择文生图或图片编辑端点。
4. 将 URL 或 data URL 参考图转换为 multipart 文件。
5. 解析 URL、带前缀 Base64 和纯 Base64 图片结果。
6. 返回当前项目统一的 provider、model 和 images 结构。

页面比例映射固定为：

| 页面比例 | API易 size |
| --- | --- |
| `1:1` | `2048x2048` |
| `3:4` | `1536x2048` |
| `4:3` | `2048x1536` |
| `9:16` | `1152x2048` |
| `16:9` | `2048x1152` |

未知比例回退到 `2048x2048`。这保持现有页面接口不变，同时只发送供应商明确支持的尺寸。

#### 文生图

向 `APIYI_IMAGE_URL` 发送 JSON：

```json
{
  "model": "gpt-image-2-vip",
  "prompt": "用户提示词",
  "size": "1536x2048",
  "response_format": "b64_json"
}
```

请求头包含 `Content-Type: application/json` 和 `Authorization: Bearer ...`。

#### 图生图与多图融合

向 `APIYI_IMAGE_EDIT_URL` 发送 `multipart/form-data`。表单包含 `model`、`prompt`、`size`、`response_format=b64_json`，每张参考图按页面顺序重复追加同名 `image` 文件字段。不得发送交互式文档生成器展示的 `image.items` 伪字段。

#### 张数、并发和超时

模型单次只返回一张图片，且不支持 `n`。请求数量按当前页面 `count` 限制在 1 到 10，每张图片发起一次独立请求，并沿用 `OPENAI_IMAGE_PARALLEL_REQUESTS` 的并发上限。不得发送 `n` 或 `quality`，避免无效参数和错误计费。

每个上游请求使用 360 秒超时，覆盖供应商标注的典型 90 到 150 秒生成时间及高峰长尾。首版不自动重试，避免一次页面操作产生未提示的重复计费。

### 计费与结果保存

每次上游调用前沿用主站计费预留流程，providerId 使用 `apiyi`，model 使用实际上游模型名。调用成功后结算媒体额度；上游或解析失败时释放预留额度。

适配器显式请求 `b64_json`，避免依赖约 24 小时有效的临时 URL。若上游返回纯 Base64，适配器补成 `data:image/png;base64,...`；若已经带 data URL 前缀则保持原值；若意外返回 URL 也兼容解析。随后继续由现有结果缓存和 COS 保存流程接管。

## 错误处理

- 缺少密钥：抛出 `gpt-image2-vip 配置缺失：APIYI_IMAGE_API_KEY`，不包含密钥值。
- 参考图下载失败：包含安全的 HTTP 状态，不记录图片内容。
- 上游 HTTP 或业务失败：返回模型名、HTTP 状态和供应商安全错误消息。
- 成功响应没有图片：明确提示 API易未返回图片数据。
- 请求超时：提示 API易生成超时，允许用户主动重试。
- 主站计费失败：保持现有 `MainAppBillingError` 行为，不发起未预留额度的上游调用。

不在日志中输出 Authorization、完整 Base64、参考图二进制或用户密钥。

## 测试策略

按照 TDD 实施，先写测试并确认因功能缺失而失败，再写最小代码使其通过：

- `tests/content-production-contract.test.ts`：类型和统一页面选择器包含 `gpt-image2-vip`。
- 新增 `tests/apiyi-image.test.ts`：覆盖文生图请求、五种比例映射、单图和多图 multipart、重复 `image` 字段、无 `n`/`quality`、Base64 两种形态、URL 响应、缺少密钥和上游失败。
- `tests/image-generation-job-route.test.ts`：覆盖精确路由分发、本地参考图保留、内网 URL 拒绝和作业结果。
- 完整测试套件确认其他图片模型没有回归。

## 真实验证

自动化测试和生产构建通过后，使用 `.env.local` 中的真实配置执行：

1. 一次 `1:1` 文生图探针，由适配器按设计映射为 `2048x2048`，验证鉴权、请求字段和响应解析。
2. 使用第一张输出作为参考图执行一次简单图生图探针，验证 multipart 上传和编辑响应。

模型按次计费，两次探针预计产生两张图片费用。探针产物只保存在本地临时位置，不提交到 Git；完成后检查日志和 Git diff，确认密钥及图片二进制没有进入仓库。

## 验证命令

实施完成后执行：

1. 新适配器测试。
2. 图片路由测试和页面契约测试。
3. `npm.cmd test` 完整测试套件。
4. `npm.cmd run build` 生产构建。
5. `git diff --check`。
6. 密钥模式扫描，确认被跟踪文件中不存在真实密钥。

## 成功标准

- 图片生成页面的全局和每页模型下拉框均能选择 `gpt-image2-vip`。
- 不带参考图时调用 API易文生图端点；带一张或多张参考图时调用图片编辑端点。
- 多张参考图按顺序作为重复的 `image` 文件字段上传。
- 页面五种比例全部映射为有效的 API易 2K 尺寸。
- 多张生成通过独立请求实现，不发送 `n` 或 `quality`。
- URL、带前缀 Base64 和纯 Base64 响应均能进入现有缓存与保存流程。
- 真实密钥只存在于 `.env.local`，所有被跟踪文件均不包含密钥。
- 新增测试、完整测试套件和生产构建通过，真实文生图与图生图探针各成功一次。
