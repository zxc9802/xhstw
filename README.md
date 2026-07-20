# 内容生产中台 / Content Production Studio

这是一个本地运行的多平台内容生产中台，用于选题管理、内容生成、检测筛选、素材规划、账号管理、模板复用和本地归档。当前重点场景是小红书防晒/护肤内容生产，但系统结构预留 TikTok、抖音、Instagram、Facebook 等平台扩展。

## 项目定位

- 本地内容生产、审核、检测、素材规划和归档工具。
- 不自动发布任何平台内容。
- 不登录小红书、抖音、TikTok、Instagram、Facebook。
- 不模拟浏览器进入平台后台抓取数据。
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
- OpenCLI 小红书公开选题采集：`lib/adapters/opencli-xiaohongshu.ts`

## OpenCLI 小红书选题采集

项目已预留 `POST /api/topics/opencli-xhs`，由本地 API route 调用 OpenCLI adapter，再写入平台选题库页面状态。当前只用于只读公开搜索，不发布、不关注、不读取创作者后台、不使用平台登录后台数据。

如果 OpenCLI Browser Bridge extension 未连接，接口会自动返回 `data/topics/xiaohongshu-opencli-hot.json` 中的 fallback 选题样本，并在页面提示原因。可在 `.env.local` 配置：

```text
OPENCLI_BIN=opencli.cmd
```

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
