# 共享 CDP Chrome 部署设计

## 目标

在 Zeabur 服务器 `qy` 上新增一个供小红书公开素材抓取使用的共享 Chrome 实例，让 Zeabur 应用通过 `OPENCLI_CDP_ENDPOINT` 连接。现有 `/home/ubuntu/.opencli/chrome/worker-1` Chrome、OpenCLI daemon 和已连接 Browser Bridge Profile 保持不动。

## 已确认现状

- 服务器已安装 Google Chrome 和 OpenCLI 1.8.6。
- 现有 Chrome 使用 `/home/ubuntu/.opencli/chrome/worker-1`，并已连接 OpenCLI Browser Bridge。
- 现有 Chrome 没有开启 CDP，`127.0.0.1:9222/json/version` 返回连接拒绝。
- Zeabur 应用容器中的 `/app/node_modules/.bin/opencli` 与服务器 OpenCLI 属于两个独立运行环境，服务器本地 Profile 不能直接被容器复用。

## 方案

新增第二个 Chrome 实例，使用独立用户目录 `/home/ubuntu/.opencli/chrome/cdp-worker` 和独立的 systemd 用户服务。它监听 CDP 端口 9222，不加载个人账号，仅用于抓取公开页面。现有 Chrome 不停止、不改参数，因此新方案失败时不会影响当前 Browser Bridge。

部署分两阶段：

1. 先临时启动新 Chrome，在服务器本机通过 `/json/version` 和 `/json/list` 验证 CDP。
2. 再将其固化为 systemd 用户服务，启用自动重启和用户 linger，最后从 Zeabur 应用容器验证私网连通性。

## 网络与安全

- 首选使用服务器 CNI 私网接口 `10.42.0.1:9222`，候选应用端地址为 `http://10.42.0.1:9222`。
- 在 Zeabur 应用容器实际 `curl` 成功前，不写入生产环境变量。
- 不给 9222 配置公网域名，不允许无鉴权 CDP 暴露到互联网。若应用容器无法访问该私网接口，停止该路线并改用带鉴权的 OpenCLI Worker API，不直接开放公网 9222。
- 新 Chrome 使用独立、无敏感登录信息的用户目录，降低共享浏览器泄露 Cookie 的风险。

## 应用配置

私网验证通过后，在小红书应用服务中设置：

```env
OPENCLI_BIN=opencli
OPENCLI_CDP_ENDPOINT=http://10.42.0.1:9222
OPENCLI_XHS_BROWSER_SESSION=content-production-xhs
```

必须删除 `OPENCLI_PROFILE`，然后重新部署应用。`OPENCLI_CDP_ENDPOINT` 存在时，OpenCLI 应走 CDP 直连，不再查找服务器本地 Browser Bridge Profile。

## 验证标准

依次满足以下条件才算完成：

1. 现有 `worker-1` Chrome 和已连接 Profile 仍正常。
2. 服务器本机访问 `http://127.0.0.1:9222/json/version` 或选定监听地址能返回 `webSocketDebuggerUrl`。
3. Zeabur 应用容器能访问同一 `/json/version`。
4. 应用容器内 `opencli doctor` 不再报告 Profile 未连接。
5. `opencli browser <session> open/state` 能返回小红书页面状态。
6. 网页“抓取”功能能获得新的公开素材。

## 并发边界

第一阶段只保证一个共享 Chrome 的低并发公开素材抓取。若多人同时抓取出现标签页互相干扰，应在应用侧将抓取任务串行化或增加多个独立 Chrome worker；本次不扩展该范围。

## 回滚

如新 Chrome 或私网连接失败：

1. 停止并禁用新建的 CDP Chrome 用户服务。
2. 删除 Zeabur 的 `OPENCLI_CDP_ENDPOINT` 并重新部署。
3. 保留现有 `worker-1` Chrome、OpenCLI daemon 和 Browser Bridge Profile，不做任何修改。
