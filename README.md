# 内容生产中台 / Content Production Studio

这是一个本地运行的多平台内容生产中台，用于选题管理、内容生成、检测筛选、素材规划、账号管理、模板复用和本地归档。当前重点场景是小红书防晒/护肤内容生产，但系统结构预留 TikTok、抖音、Instagram、Facebook 等平台扩展。

## 项目定位

- 本地内容生产、审核、检测、素材规划和归档工具。
- 不自动发布任何平台内容。
- 服务器不登录小红书、抖音、TikTok、Instagram、Facebook。
- 小红书选题采集由用户可选安装的本机浏览器扩展执行，使用用户当前浏览器的登录状态；服务器不代理平台访问。
- 不接管电脑，不做真实剪映自动剪辑。

## 启动方式

```powershell
cd E:\content-production-studio
npm install
npm run dev
```

默认访问：

```text
http://127.0.0.1:3000
```

## .env.local 配置方式

复制 `.env.example` 为 `.env.local`，再按需填写 API Key。

```powershell
Copy-Item .env.example .env.local
```

默认 `MOCK_MODE=true`，没有 API Key 时所有 adapter 都会自动 fallback 到 mock，不会让页面报错。

## Mock 模式说明

当前页面、API 和 adapter 均可在 mock 模式下运行。mock 数据主要放在：

- `lib/mock/data.ts`
- `data/accounts/accounts.json`
- `data/mock/output-structures.json`

## API Adapter 说明

页面组件不直接调用 DeepSeek、OpenAI、GPT Image、Nano Banana 2、Seedance 2.0。所有能力通过本地 API route 调用 adapter：

- 文案：`lib/adapters/deepseek.ts`、`lib/adapters/openai-copy.ts`
- 图片：`lib/adapters/openai-image.ts`、`lib/adapters/nano-banana.ts`
- 视频：`lib/adapters/seedance.ts`
- 查重检测：`lib/adapters/duplicate-checker.ts`
- 参考解析：`lib/adapters/reference-parser.ts`
- 本地保存：`lib/adapters/local-storage.ts`
- 自动剪辑占位：`lib/adapters/editing-adapter.ts`
- 小红书本机浏览器采集：`lib/xhs-extension-client.ts`、`browser-extension/`

## 小红书本机浏览器选题采集

选题库页面通过本机浏览器扩展下达固定的搜索和详情读取任务。扩展只读取当前页面可见的公开内容，采集结果直接回传给当前网页并保存在浏览器本地；服务器不登录小红书，也不转发小红书页面、图片或视频请求。

部署后需要为正式网站域名打包扩展，并由每位使用者在 Chrome 或 Edge 中安装。详细步骤、权限范围和风控处理方式见 [小红书本机浏览器扩展安装说明](docs/xhs-browser-extension-install.md)。旧的 `POST /api/topics/opencli-xhs`、`/api/topics/open-xhs-link` 和 `/api/topics/media-proxy` 路由已停用并返回 `410 Gone`。

## 目录结构说明

```text
app/              页面与 API routes
components/       布局、UI 与模块组件
lib/adapters/     外部模型和本地能力 adapter
lib/mock/         mock 数据
types/            通用业务类型
data/             账号、项目、选题、模板、设置、复盘数据
assets/           头像、产品、参考、UGC、视频、剪辑素材
outputs/          本地内容输出与归档
logs/             日志
exports/          导出文件
backups/          备份
```

## 本地输出路径说明

图文项目示例：

```text
outputs/xhs_01_baitao_yangfuji/2026-07-08/001_夏天通勤防晒喷雾/
  images/
  title.txt
  copy.txt
  hashtags.txt
  image_prompts.json
  reference_sources.json
  check_report.json
  review_notes.txt
  metadata.json
```

视频项目示例：

```text
outputs/video/2026-07-08/001_防晒补涂口播视频/
  shots/
  selected_shots.json
  script.txt
  shot_prompts.json
  voiceover.txt
  check_report.json
  metadata.json
```

## 当前阶段

- 已完成新项目骨架、账号资料库、内容生成中心重构、API adapter 结构和本地目录结构。
- 自动剪辑模块仅预留路由、API、adapter 和占位页面，完整剪辑功能将在后续阶段实现。
