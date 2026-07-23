# 图片生成 Job ID 轮询设计

## 目标

将 `/api/image/generate` 从等待图片模型完整返回的同步请求，改为立即返回本地 `jobId` 的异步任务接口。前端使用短请求轮询任务状态，避免单次请求等待超过 Cloudflare 时限并产生 HTTP 524。

## 运行边界

当前项目部署为 Zeabur 中的单实例 Node 服务，仓库没有 Redis、数据库或外部队列。本次使用进程内任务存储；不新增基础设施。

- 服务正常运行时，任务可在 POST 返回后继续执行，并通过后续 GET 查询。
- 服务重启、重新部署或切换实例后，未完成任务会丢失。前端收到任务不存在时提示重新生成。
- 本次不增加持久化、跨实例协调、取消任务或任务历史页面。

## 服务端数据流

1. `POST /api/image/generate` 解析并校验现有请求体。
2. 服务端生成随机 UUID，写入状态为 `queued` 的进程内任务。
3. 服务端启动不阻塞响应的生成 Promise，将状态更新为 `processing`。
4. POST 立即以 HTTP 202 返回：

```json
{
  "ok": true,
  "data": {
    "jobId": "uuid",
    "status": "queued"
  }
}
```

5. 后台任务继续调用现有 `generateImage` 或 `generateWithNanoBanana`，不改变模型选择、提示词、批量数、并发数及图片结果结构。
6. 成功时任务变为 `completed` 并保存原有生成结果；失败时变为 `failed` 并保存安全的错误消息。
7. `GET /api/image/generate/[jobId]` 返回任务快照：
   - `queued` / `processing`：只返回状态和时间信息。
   - `completed`：额外返回 `result`。
   - `failed`：额外返回 `error`。
   - 未知或已丢失：返回 404。

任务存储通过 `globalThis` 在同一 Node 进程内复用。每次创建或读取任务时清理已完成或失败超过 30 分钟的记录，防止进程长期运行时无限增长。

## 前端轮询

`generateSinglePlanImage` 提交生成请求后：

1. 收到 HTTP 202 时读取 `jobId`。
2. 每 3 秒请求一次 `/api/image/generate/{jobId}`。
3. `queued` / `processing` 时继续轮询，并保持页面卡片为“生成中”。
4. `completed` 时把 `result` 交给现有图片 URL 解析和页面更新逻辑。
5. `failed`、404 或超过 6 分钟时停止轮询，并通过现有 P1/P2 失败提示显示具体原因。

轮询 GET 都是短请求，不会触发原同步生成请求的 Cloudflare 524。页面卸载后浏览器轮询自然停止，但服务端生成任务继续运行到完成或五分钟上游超时。

## 兼容性

- `/api/image/generate` 的所有提供商统一返回 202 任务协议，使前端只有一套处理方式。
- `/api/image/regenerate-single` 保持现状，不在本次范围内。
- 现有图片结果格式、IndexedDB 历史记录和生成完成后的页面行为不变。
- 没有配置真实模型密钥时，mock 生成也经过同一任务状态机，但会很快完成。

## 错误处理

- 后台任务捕获所有异常并写入 `failed`，避免未处理 Promise rejection。
- API 不返回密钥、授权头或完整上游原始响应。
- 任务不存在时，前端明确提示“任务已失效，可能是服务重启，请重新生成”。
- 客户端轮询请求失败时终止当前生成并保留现有失败状态，不无限重试。

## 测试与验收

1. 任务从 `queued` 进入 `processing`，最终进入 `completed` 并保留结果。
2. 生成异常时任务进入 `failed` 并保存错误消息。
3. 未知任务查询返回 404。
4. POST 在生成 Promise 完成前返回 HTTP 202 和 `jobId`。
5. 客户端能从 `queued` / `processing` 轮询到 `completed`，并能处理 `failed`、404 和超时。
6. 完整测试、TypeScript/Next.js 生产构建通过。
7. 上线后发起一次真实四图生成，确认 POST 不再出现 524，页面能持续轮询并最终显示图片。
