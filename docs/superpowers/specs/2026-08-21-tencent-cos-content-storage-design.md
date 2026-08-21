# 腾讯云 COS 成品内容存储设计

## 目标

将内容生产流程最终采用的文字和图片保存到腾讯云 COS，并让 COS 成为成品内容库的唯一持久化数据源。

本次接入必须满足：

- 只有用户点击“保存到内容库”时才上传最终采用的文字和图片。
- 文案候选和图片候选只存在当前页面内存，刷新或关闭页面后丢失。
- 成品不再写入浏览器 `localStorage`、`IndexedDB` 或本机目录。
- 每位成员只能列出、预览、修改和删除自己保存的内容。
- COS 存储桶保持私有读写。
- COS 保存失败时明确报错，不回退到本地保存。

## 范围

### 本次包含

- 图文生产页的成品保存流程。
- 视频生产页的最终脚本和成品元数据保存；现有视频 URL 只作为外部媒体引用保存，视频文件本身不复制到 COS，也不扩展新的视频能力。
- 成品内容库的列表、详情、图片预览、状态修改、内容编辑、图片增删和成品删除。
- 与上述流程直接相关的本地成品、生成历史和生产草稿持久化移除。
- COS 环境配置、最小权限、跨域配置和真实连通性验证。

### 本次不包含

- 账号资料、模板、选题、设置、产品库和参考素材库的存储迁移。
- 迁移浏览器里已有的本地成品记录。
- 把 COS 设置为公有读或提供长期公开图片链接。
- 新增数据库、消息队列、后台定时任务或 CDN。
- 改造与本次成品存储无关的页面和适配器。

用户主动点击“导出/下载内容包”仍被允许。该操作是一次性下载，不是系统持久化数据源。

## 当前状态

当前成品链路没有可靠的服务端持久化：

- 成品文字和内容库记录写在浏览器 `localStorage`。
- 成品图片及部分生成图片写在浏览器 `IndexedDB`。
- 图片生成接口的服务端结果缓存只保留约 30 分钟。
- `/api/storage/save-project`、`save-prompt` 和 `archive` 仍调用 mock `local-storage` 适配器。
- 内容库展示本地记录和 mock 种子，并使用假的 `localPath`。

因此，换浏览器、清站点数据或服务重启都会造成内容不可用或不一致。

## 已确认的技术方案

采用“服务端签发预签名上传地址、浏览器直传私有 COS、服务端提交清单”的方案。

图片上传不经过 Cloudflare Worker，以避免重复传输和请求体限制。文字、元数据和成品状态保存在小型 `manifest.json` 中。服务端使用当前 SSO 会话里的 `user.id` 构造对象路径，客户端传入的成员编号不参与授权判断。

COS 提供 S3 兼容接口。服务端使用适合 Cloudflare Worker 的 AWS SDK for JavaScript v3 S3 客户端和预签名组件，连接腾讯云 COS 的虚拟主机式地域端点。实现阶段必须通过真实小文件探针验证 SDK、签名和端点组合，不以仅构建成功代替运行验证。

## 对象布局

```text
users/{userId}/contents/{contentId}/manifest.json
users/{userId}/contents/{contentId}/images/001.webp
users/{userId}/contents/{contentId}/images/002.webp
```

约束：

- `userId` 只来自服务端解密并校验后的 SSO 会话。
- `contentId` 由服务端生成，包含可排序时间和随机后缀，不接受客户端自定义路径。
- 图片文件名由服务端生成，不使用原始文件名作为对象路径。
- 所有路径都经过固定前缀拼接；API 不接受任意 COS Key。
- `manifest.json` 是提交标记。没有清单的前缀不会出现在内容库。

## 成品清单

每个成品使用一个带版本号的 JSON 清单。清单至少包含：

```ts
type ReferenceSourceSnapshot = {
  title: string;
  url: string;
  platform: string;
  media: Array<{
    type: "image" | "video";
    url: string;
    name?: string;
    posterUrl?: string;
  }>;
};

type StoredContentManifest = {
  schemaVersion: 1;
  id: string;
  ownerId: string;
  title: string;
  summary: string;
  body: string;
  platform: string;
  account: string;
  type: string;
  mediaKind: "image" | "video";
  media: Array<
    | {
        storage: "cos";
        key: string;
        contentType: string;
        size: number;
      }
    | {
        storage: "external";
        mediaType: "video";
        url: string;
      }
  >;
  pages: Array<{
    page: number;
    title: string;
    copy: string;
    prompt: string;
    provider: string;
    sourceImages: string[];
  }>;
  referenceSources: ReferenceSourceSnapshot[];
  tags: string[];
  folder: string | null;
  prompts: string[];
  negativePrompts: string[];
  status: string;
  systemState: "active" | "deleting";
  duplicateRate: number;
  duplicateLabel: string;
  lowFlowRisk: string;
  checkAdvice: string[];
  reviewNotes: string[];
  createdAt: string;
  updatedAt: string;
};
```

`ReferenceSourceSnapshot` 沿用当前已规范化的参考来源字段，只保存标题、平台、原始链接和现有参考媒体描述，不在本次重新抓取或复制参考素材。仅浏览器本地可解析的参考媒体 URL 不写入清单，避免云端清单引用其他设备无法读取的数据。

COS 图片只保存稳定对象键，不保存会过期的预签名 URL。视频文件不在本次复制范围内，现有视频成品 URL 作为外部引用明确标记，不经过图片媒体代理。读取时必须校验 `schemaVersion`、`ownerId` 和字段类型；损坏或不属于当前成员的清单不得返回给前端。

## 服务端组件

### COS 配置与客户端

新增独立的服务端 COS 模块，负责：

- 读取并校验 COS 环境变量。
- 构造 S3 兼容客户端和预签名器。
- 生成成员前缀、成品前缀和图片对象键。
- 封装列出、读取、写入、检查和删除对象操作。
- 将 COS 错误转换为稳定的应用错误。除成功申请上传时返回的短期预签名 PUT 地址外，不向前端泄露密钥、签名或内部响应内容。

### API 边界

新增以下同域、受现有 SSO 中间件保护的接口：

- `POST /api/content-storage/upload-intents`
  - 为一个成品生成 `contentId`；允许图片列表为空。
  - 为每张图片生成对象键和短期预签名 PUT 地址。
  - 校验图片数量、MIME 类型和大小。
  - 返回由服务端签名的短期上传意图令牌，令牌绑定当前成员、`contentId`、对象键和到期时间。
- `POST /api/content-storage/items/{contentId}/commit`
  - 验证上传意图令牌，只接受当前会话成员前缀下、由该意图生成的对象键。
  - 使用 HEAD 确认每张图片存在且基本元数据匹配。
  - 最后写入 `manifest.json`。
- `GET /api/content-storage/items`
  - 只列出当前成员 `contents/` 前缀中的清单，支持分页。
- `GET /api/content-storage/items/{contentId}`
  - 返回当前成员的单个清单。
- `GET /api/content-storage/items/{contentId}/media/{fileId}`
  - 校验当前成员和清单引用后，从 COS 流式读取图片。
  - 只返回允许的图片 MIME 类型，并设置正确的 `Content-Type` 和内联响应头。
- `PATCH /api/content-storage/items/{contentId}`
  - 更新当前成员的清单，并验证编辑时新增图片对应的上传意图令牌。
- `POST /api/content-storage/items/{contentId}/upload-intents`
  - 为已存在成品的新增图片生成对象键、短期预签名 PUT 地址和绑定该成品的编辑上传意图令牌。
- `DELETE /api/content-storage/items/{contentId}`
  - 二次确认后删除当前成员清单中引用的媒体和清单本身。

动态路由的客户端参数只用于定位 `contentId` 和清单内的媒体编号。服务端始终重新拼接当前成员前缀，不把客户端参数直接当成对象键。上传意图令牌使用服务端现有会话密钥派生的独立 HMAC 密钥签名，不引入新的持久化会话存储。

## 保存数据流

1. 用户在生产页选择最终文字和图片，点击“保存到内容库”。
2. 页面冻结本次保存快照并禁用重复提交。
3. 页面为每条成品申请上传意图。现有批量图文保存按成品逐条执行，每条成品独立提交；没有图片的成品会得到不含上传地址的意图和提交令牌。
4. 浏览器使用短期预签名 PUT 地址把图片直接上传到 COS，并显示总体和单张进度。
5. 图片全部上传后，页面提交文字和清单数据；没有 COS 图片的成品直接提交清单。
6. 服务端验证会话、对象前缀、对象存在性和清单字段。
7. 服务端最后写入 `manifest.json`。
8. 页面只在提交成功后跳转内容库，并从 COS 重新读取成品。

单个成品以 `manifest.json` 为原子可见边界。批量保存不是跨成品事务：已成功提交的成品保留，失败的成品可以单独重试，界面必须明确显示成功数和失败数。

## 内容库读取与图片预览

内容库不再读取本地成品键或 mock 种子。它通过服务端列出当前成员的清单，并在筛选、详情和编辑界面使用清单数据。

COS 图片预览使用本站鉴权代理，而不是把 COS 默认域名或预签名 GET URL 交给浏览器：

- 浏览器请求本站媒体接口。
- 服务端验证 SSO 会话和清单引用。
- 服务端从私有 COS 流式读取图片并返回。
- 响应使用私有缓存策略，不允许把其他成员对象当作任意代理目标。

这样无需为 COS 绑定自定义预览域名，也规避 2024 年后新建存储桶默认域名强制下载的问题。图片上传仍然使用浏览器直传，不受该读取路径影响。

## 编辑、状态和删除

- 标题、正文、标签、提示词、状态和审核记录的修改写回当前成员的清单。
- 编辑时新增图片先上传，确认成功后再更新清单。
- 编辑时删除图片先从清单移除并成功写入新清单，再尽力删除失去引用的对象，避免对象删除成功但清单更新失败导致成品损坏。
- 删除成品先读取并校验清单，将 `systemState` 改为 `deleting` 使其从普通列表隐藏，再删除清单中引用的对象，最后删除清单。失败时保留可重试的删除状态和媒体列表。
- 所有变更成功后重新读取服务端数据，不用本地记录作为成功依据。

## 本地持久化调整

仅移除生成成品链路的持久化：

- 生产页不再把生成文案草稿、生成图片历史和最终成品写入 `localStorage`。
- 生产页不再把生成候选图或最终成品图写入通用图片 `IndexedDB`；候选图片在页面生命周期内使用内存 URL 或当前短期生成结果 URL。
- 内容库不再读取或写入成品、删除标记和内容库文件夹的本地键。
- 内容库状态、编辑和文件夹归属若继续显示，必须来自成品清单；空自定义文件夹不再单独持久化。
- 删除假的 `localPath` 展示和“选择本地保存文件夹”保存步骤。

账号、模板、选题、设置、产品库和参考素材现有本地存储保持不变。用户主动导出内容包的下载能力保留。

## 安全设计

- 存储桶保持私有读写。
- `SecretId` 和 `SecretKey` 只存在 Cloudflare 服务端 Secrets，不进入 `NEXT_PUBLIC_*`、源代码、日志或接口响应。
- 使用独立 CAM 子账号，权限限定到 `xshcp-1410143389` 的 `users/*` 前缀。
- 仅授权实现需要的列出、读取、简单上传和删除操作；不授予存储桶管理、公有 ACL 或策略修改权限。
- 预签名 PUT 地址和上传意图令牌有效期为 10 分钟，并固定对象键、方法和必要请求头。
- 每条成品最多 20 张图片，单张不超过 20 MB、合计不超过 100 MB；只允许 JPEG、PNG、WebP、GIF 和 AVIF。
- 清单 JSON 不超过 1 MB。
- 媒体代理只返回清单中引用的图片，拒绝路径穿越、跨成员引用、未知 MIME 和不存在对象。
- 日志只记录请求 ID、成员 ID、成品 ID、对象数量和归一化错误类型，不记录密钥或完整签名 URL。

服务端环境变量名称和用途：

```text
TENCENT_COS_BUCKET=xshcp-1410143389
TENCENT_COS_REGION=ap-singapore
TENCENT_COS_SECRET_ID     # 通过 Cloudflare Secret 配置
TENCENT_COS_SECRET_KEY    # 通过 Cloudflare Secret 配置
```

## COS 控制台配置

为浏览器直传配置最小 CORS 规则：

- Allowed Origins：`https://xhstw.qycm.top`、`http://127.0.0.1:3000`、`http://localhost:3000`。
- Allowed Methods：`PUT`。
- Allowed Headers：`*`，避免预签名上传所签请求头与预检不一致。
- Expose Headers：`ETag`。
- Max Age：600 秒。

图片读取通过同域应用代理完成，因此无需开放 COS 的浏览器 GET 跨域，也无需把存储桶改为公有读。

CAM 策略限制在当前存储桶和 `users/*` 对象前缀，并为列举操作添加 `cos:prefix` 条件。实现阶段应在腾讯云控制台以策略模拟或真实最小账号验证列出、上传、读取和删除均可用，同时确认无法访问其他桶和非 `users/*` 前缀。

## 错误处理

- COS 未配置：接口返回明确配置错误，页面不尝试本地降级。
- 上传地址过期：页面重新申请当前图片的上传地址并重试。
- 图片上传失败：不提交该成品清单，保留页面内存快照供重试。
- 对象验证失败：不写清单，并报告具体失败图片序号。
- 清单写入失败：成品不可见；页面报告失败并尽力删除本次已上传对象。
- 页面在上传中被关闭：可能留下无清单引用的私有对象，但不会在内容库显示。第一版不增加定时清理系统；正常可捕获失败会立即尽力清理，硬中断残留作为明确接受的成本权衡。
- 内容库读取失败：保留错误状态和重试按钮，不展示本地或 mock 数据冒充成功结果。
- 编辑失败：旧清单保持可用。
- 删除部分失败：清单保持 `deleting` 状态并返回归一化摘要；后续重试从该清单继续，操作必须是幂等的。

## 测试与验收

### 单元测试

- 成员前缀和对象键生成稳定且拒绝路径穿越。
- 清单 schema 校验拒绝错误版本、跨成员 owner 和无效媒体键。
- 上传意图限制数量、单张大小、总大小和 MIME 类型。
- API 永远使用会话 `user.id`，忽略或拒绝客户端伪造 owner。
- COS 错误映射不泄露密钥或签名。
- 本地成品键不再被生产页和内容库读写。

### API 与组件测试

- 保存顺序严格为申请地址、上传图片、确认对象、写清单。
- 任意图片失败时不调用清单提交。
- 内容库只渲染服务端返回的当前成员成品。
- 媒体代理拒绝另一个成员的 `contentId` 和媒体编号。
- 编辑先写新清单再清理失去引用的图片。
- 删除接口可重复调用且不会越过成员前缀。
- COS 故障时页面显示错误且不写本地成品。

### 真实运行验证

1. 使用部署环境同一套 COS 客户端，对 `users/{testUser}/diagnostics/` 执行小文件上传、HEAD、读取和删除探针。
2. 使用成员甲保存一条含文字和图片的成品，刷新后确认从 COS 恢复。
3. 使用成员乙确认无法列出、预览、修改或删除成员甲的成品。
4. 确认候选内容刷新后消失，并检查浏览器没有新增生成内容相关的 `localStorage` 或 `IndexedDB` 记录。
5. 模拟一张图片上传失败，确认内容库没有该成品清单。
6. 运行相关单元测试、完整测试集和生产构建。

## 成功标准

- 新保存的成品文字和图片只持久化在私有 COS。
- 内容库刷新后从 COS 恢复数据，不依赖浏览器本地记录。
- 服务端和对象路径共同保证成员隔离。
- COS 故障不会静默回退或产生假成功提示。
- 账号、模板、选题、设置等非目标模块没有行为变化。
- 真实 COS 探针、双成员隔离验证、自动化测试和生产构建全部通过后，才可宣告接入完成。
