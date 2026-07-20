# Shared CDP Chrome Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Zeabur 服务器 `qy` 上新增一个不影响现有 Browser Bridge 的独立共享 Chrome，并让小红书应用通过私网 CDP 抓取公开素材。

**Architecture:** 新 Chrome 使用独立目录 `/home/ubuntu/.opencli/chrome/cdp-worker`，仅在服务器回环地址 `127.0.0.1:9222` 提供 CDP。`socat` 将该端口转发到 Zeabur CNI 私网接口 `10.42.0.1:9223`，应用容器使用 `OPENCLI_CDP_ENDPOINT=http://10.42.0.1:9223`，不再使用 Browser Bridge Profile。

**Tech Stack:** Ubuntu, Google Chrome, Chrome DevTools Protocol, systemd user services, socat, OpenCLI 1.8.6, Zeabur

---

### Task 1: 记录基线并确认端口可用

**Files:**
- Inspect: `/opt/google/chrome/chrome`
- Inspect: `/home/ubuntu/.opencli/chrome/worker-1`
- Inspect: server TCP ports `9222` and `9223`

- [ ] **Step 1: 确认现有 Browser Bridge 不受影响**

在 Zeabur 的 `Server > qy` 控制台运行：

```bash
opencli daemon status
opencli profile list
```

Expected: daemon 为 `running`，现有 Profile 为 `connected`。

- [ ] **Step 2: 确认 Chrome 可执行文件和 CNI 地址**

```bash
test -x /opt/google/chrome/chrome && echo CHROME_OK
ip -4 addr show cni0
```

Expected: 输出 `CHROME_OK`，`cni0` 包含 `10.42.0.1`。

- [ ] **Step 3: 确认新端口未被占用**

```bash
ss -lntp | grep -E ':(9222|9223)\b' || echo PORTS_FREE
```

Expected: 输出 `PORTS_FREE`。如端口已占用，停止本计划并先确认占用进程，不直接终止未知进程。

### Task 2: 安装私网转发工具

**Files:**
- Install: `/usr/bin/socat`

- [ ] **Step 1: 检查并安装 socat**

```bash
command -v socat || { sudo apt-get update && sudo apt-get install -y socat; }
```

Expected: `command -v socat` 最终返回 `/usr/bin/socat`。

- [ ] **Step 2: 确认安装结果**

```bash
/usr/bin/socat -V | head -n 1
```

Expected: 输出 socat 版本信息。

### Task 3: 临时启动独立 CDP Chrome

**Files:**
- Create: `/home/ubuntu/.opencli/chrome/cdp-worker/`
- Create: `/home/ubuntu/.opencli/chrome/cdp-worker.log`
- Create: `/home/ubuntu/.opencli/chrome/cdp-worker.pid`

- [ ] **Step 1: 创建隔离用户目录**

```bash
install -d -m 700 /home/ubuntu/.opencli/chrome/cdp-worker
```

Expected: `stat -c '%a %U %G' /home/ubuntu/.opencli/chrome/cdp-worker` 输出 `700 ubuntu ubuntu`。

- [ ] **Step 2: 启动临时无登录 Chrome**

```bash
nohup /opt/google/chrome/chrome \
  --headless=new \
  --user-data-dir=/home/ubuntu/.opencli/chrome/cdp-worker \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --remote-allow-origins='*' \
  --no-sandbox \
  --disable-dev-shm-usage \
  --disable-gpu \
  --window-size=1920,1080 \
  --no-first-run \
  --no-default-browser-check \
  'https://www.xiaohongshu.com' \
  >/home/ubuntu/.opencli/chrome/cdp-worker.log 2>&1 &
echo $! >/home/ubuntu/.opencli/chrome/cdp-worker.pid
```

Expected: 命令返回一个后台进程号，不影响 `/home/ubuntu/.opencli/chrome/worker-1`。

- [ ] **Step 3: 等待并验证本机 CDP**

```bash
for i in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:9222/json/version; then
    break
  fi
  sleep 1
done
```

Expected: 20 秒内返回包含 `Browser` 和 `webSocketDebuggerUrl` 的 JSON。失败时运行 `tail -n 80 /home/ubuntu/.opencli/chrome/cdp-worker.log`，不要继续配置 Zeabur。

- [ ] **Step 4: 确认现有 Chrome 仍正常**

```bash
opencli daemon status
opencli profile list
```

Expected: 原 Profile 仍为 `connected`。

### Task 4: 临时建立 Zeabur 私网转发并验证

**Files:**
- Create: `/home/ubuntu/.opencli/chrome/cdp-relay.log`
- Create: `/home/ubuntu/.opencli/chrome/cdp-relay.pid`

- [ ] **Step 1: 在 CNI 私网地址启动临时 relay**

```bash
nohup /usr/bin/socat \
  TCP-LISTEN:9223,bind=10.42.0.1,reuseaddr,fork \
  TCP:127.0.0.1:9222 \
  >/home/ubuntu/.opencli/chrome/cdp-relay.log 2>&1 &
echo $! >/home/ubuntu/.opencli/chrome/cdp-relay.pid
```

Expected: `ss -lntp | grep '10.42.0.1:9223'` 显示 socat 正在监听，9223 不监听 `0.0.0.0` 或公网网卡。

- [ ] **Step 2: 在服务器上验证 relay**

```bash
curl -fsS http://10.42.0.1:9223/json/version
```

Expected: 返回与 9222 相同类型的 CDP JSON。

- [ ] **Step 3: 从小红书应用容器验证私网连通性**

在 Zeabur UI 切换到小红书应用的 `Service` 控制台运行：

```bash
curl -fsS http://10.42.0.1:9223/json/version
```

Expected: 返回包含 `webSocketDebuggerUrl` 的 JSON。若超时或拒绝连接，停止本计划，不设置生产变量；这表示应用 Pod 无法访问该节点 CNI 地址，需要改用带鉴权的 Worker API。

### Task 5: 将临时进程固化为 systemd 用户服务

**Files:**
- Create: `/home/ubuntu/.config/systemd/user/opencli-cdp-chrome.service`
- Create: `/home/ubuntu/.config/systemd/user/opencli-cdp-relay.service`

- [ ] **Step 1: 停止仅属于新目录的临时进程**

```bash
if test -f /home/ubuntu/.opencli/chrome/cdp-relay.pid; then
  kill "$(cat /home/ubuntu/.opencli/chrome/cdp-relay.pid)" 2>/dev/null || true
fi
if test -f /home/ubuntu/.opencli/chrome/cdp-worker.pid; then
  kill "$(cat /home/ubuntu/.opencli/chrome/cdp-worker.pid)" 2>/dev/null || true
fi
```

Expected: `ss -lntp | grep -E ':(9222|9223)\b' || echo TEMP_STOPPED` 输出 `TEMP_STOPPED`。现有 `worker-1` Chrome 不受影响。

- [ ] **Step 2: 创建用户服务目录**

```bash
install -d -m 700 /home/ubuntu/.config/systemd/user
```

- [ ] **Step 3: 创建 Chrome 服务文件**

```bash
tee /home/ubuntu/.config/systemd/user/opencli-cdp-chrome.service >/dev/null <<'EOF'
[Unit]
Description=Shared CDP Chrome for OpenCLI
After=network-online.target

[Service]
Type=simple
ExecStart=/opt/google/chrome/chrome --headless=new --user-data-dir=/home/ubuntu/.opencli/chrome/cdp-worker --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 --remote-allow-origins=* --no-sandbox --disable-dev-shm-usage --disable-gpu --window-size=1920,1080 --no-first-run --no-default-browser-check https://www.xiaohongshu.com
Restart=always
RestartSec=5
KillMode=control-group

[Install]
WantedBy=default.target
EOF
```

- [ ] **Step 4: 创建私网 relay 服务文件**

```bash
tee /home/ubuntu/.config/systemd/user/opencli-cdp-relay.service >/dev/null <<'EOF'
[Unit]
Description=Private CNI relay for OpenCLI CDP Chrome
Requires=opencli-cdp-chrome.service
After=opencli-cdp-chrome.service

[Service]
Type=simple
ExecStart=/usr/bin/socat TCP-LISTEN:9223,bind=10.42.0.1,reuseaddr,fork TCP:127.0.0.1:9222
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF
```

- [ ] **Step 5: 启用用户服务开机运行**

```bash
sudo loginctl enable-linger ubuntu
systemctl --user daemon-reload
systemctl --user enable --now opencli-cdp-chrome.service
systemctl --user enable --now opencli-cdp-relay.service
```

Expected: 两个 `enable --now` 命令成功，无失败输出。

- [ ] **Step 6: 验证持久化服务**

```bash
systemctl --user --no-pager --full status opencli-cdp-chrome.service
systemctl --user --no-pager --full status opencli-cdp-relay.service
curl -fsS http://10.42.0.1:9223/json/version
```

Expected: 两个服务均为 `active (running)`，CDP JSON 正常返回。

### Task 6: 配置 Zeabur 应用并做端到端验证

**Files:**
- Modify in Zeabur: application environment variables

- [ ] **Step 1: 修改小红书应用服务变量**

在 Zeabur 小红书应用的 `Variables` 中设置：

```env
OPENCLI_BIN=opencli
OPENCLI_CDP_ENDPOINT=http://10.42.0.1:9223
OPENCLI_XHS_BROWSER_SESSION=content-production-xhs
```

删除 `OPENCLI_PROFILE`，保存并重新部署应用。

- [ ] **Step 2: 验证容器读取了 CDP 配置**

```bash
node -e 'console.log({cdp:!!process.env.OPENCLI_CDP_ENDPOINT,profile:process.env.OPENCLI_PROFILE||"(none)",bin:process.env.OPENCLI_BIN})'
```

Expected: `{ cdp: true, profile: '(none)', bin: 'opencli' }`。

- [ ] **Step 3: 用容器内 OpenCLI 验证浏览器**

```bash
./node_modules/.bin/opencli browser cdp-check open https://www.xiaohongshu.com --window background
./node_modules/.bin/opencli browser cdp-check state
```

Expected: 不再出现 Profile 未连接，`state` 返回小红书页面状态。

- [ ] **Step 4: 验证网页抓取**

在网页“爆款选题库”点击“抓取”。

Expected: 页面返回新的公开素材，不再显示 `ENOENT` 或 `Browser profile is not connected`。

### Task 7: 回滚验证

**Files:**
- Disable: `/home/ubuntu/.config/systemd/user/opencli-cdp-chrome.service`
- Disable: `/home/ubuntu/.config/systemd/user/opencli-cdp-relay.service`
- Modify in Zeabur: remove `OPENCLI_CDP_ENDPOINT`

- [ ] **Step 1: 仅在部署失败时执行服务器回滚**

```bash
systemctl --user disable --now opencli-cdp-relay.service
systemctl --user disable --now opencli-cdp-chrome.service
```

Expected: 9222 和 9223 停止监听，原 `worker-1` Chrome 和 Browser Bridge Profile 仍正常。

- [ ] **Step 2: 仅在部署失败时执行应用回滚**

删除 Zeabur 的 `OPENCLI_CDP_ENDPOINT`，保持 `OPENCLI_BIN=opencli`，然后重新部署。

- [ ] **Step 3: 确认原链路未被破坏**

```bash
opencli daemon status
opencli profile list
```

Expected: 原 Profile 仍为 `connected`。
