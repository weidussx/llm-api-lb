# 开发交接文档（本地）

本文件用于在本机交接本项目的关键细节（架构、数据格式、打包/发布、踩坑与排障）。建议不要提交到仓库（本项目已通过本地 Git exclude 忽略该文件）。

---

## 1. 项目是什么

`llm-api-lb`（原 `llm-apikey-lb`） 是一个本地运行的 HTTP 网关：

- 管理多组上游 API Key（支持 OpenAI/Gemini/DeepSeek/自定义 OpenAI 兼容）
- 对外提供单一 OpenAI 兼容 `/v1` 入口
- 轮询可用 Key，并在 429/5xx/401/403 等情况自动冷却、重试与切换
- 提供管理 UI + Prometheus 指标

核心入口是单文件 [server.js](file:///Users/sun/Desktop/llm-key-lb/server.js)。

---

## 2. 目录与关键文件

- 服务端（核心）：[server.js](file:///Users/sun/Desktop/llm-key-lb/server.js)
- CLI（全局命令）：[cli.js](file:///Users/sun/Desktop/llm-key-lb/cli.js)
- Web UI：
  - [public/index.html](file:///Users/sun/Desktop/llm-key-lb/public/index.html)
  - [public/app.js](file:///Users/sun/Desktop/llm-key-lb/public/app.js)
  - [public/styles.css](file:///Users/sun/Desktop/llm-key-lb/public/styles.css)
- macOS `.app` 打包脚本（生成 app + Swift 启动器 + zip）：[scripts/build-mac-app.js](file:///Users/sun/Desktop/llm-key-lb/scripts/build-mac-app.js)
- CI Release：[.github/workflows/release.yml](file:///Users/sun/Desktop/llm-key-lb/.github/workflows/release.yml)
- 本地发版脚本：
  - [release.sh](file:///Users/sun/Desktop/llm-key-lb/release.sh)（打 tag 并 push）
  - [push.sh](file:///Users/sun/Desktop/llm-key-lb/push.sh)（提交并 push）

---

## 3. 快速运行与端口

本地开发（Node）：

```bash
npm i
npm start
```

默认端口：`8787`（可用 `PORT` 覆盖）。

关键 URL：

- UI：`http://localhost:${PORT}/`
- Health：`http://localhost:${PORT}/health`
- OpenAI 兼容入口：`http://localhost:${PORT}/v1`
- Metrics：`http://localhost:${PORT}/metrics`（可用 `METRICS_PATH` 改路径）

---

## 4. 环境变量（服务端）

主要在 [server.js](file:///Users/sun/Desktop/llm-key-lb/server.js) 顶部读取：

- `PORT`：监听端口（默认 8787）
- `ADMIN_TOKEN`：如果设置，保护 `/admin/*`（请求头 `x-admin-token`）
- `DATA_FILE`：状态文件路径（默认 `./data/state.json`，相对运行目录）
- `METRICS_PATH`：metrics 路径（默认 `/metrics`）
- `LAUNCHER_MODE`：`1/0`，是否启动 launcher 模式
- `AUTO_OPEN_BROWSER`：`1/0`，是否自动打开浏览器
- `LLM_API_LB_INSTANCE_ID`：实例 ID（用于 macOS App 启动校验与避免误连旧实例）

---

## 5. 状态文件（DATA_FILE）格式

默认：`./data/state.json`（相对当前工作目录）。macOS `.app` 默认写到：

`~/Library/Application Support/llm-api-lb/state.json`

`state.json` 顶层结构（读取时会补默认值）：

- `version: number`（默认 1）
- `rrIndex: number`（默认 0，全局轮询指针，兼容字段）
- `rrIndexByPool: Record<string, number>`（默认 `{}`，按“provider+model”分池的轮询指针）
- `keys: Key[]`

Key（创建/保存字段，明文保存 `apiKey`）：

- `id: string`（uuid）
- `name: string`
- `provider: "openai"|"gemini"|"deepseek"|"custom"`
- `apiKey: string`（明文落盘；管理 API 返回时会 mask）
- `baseUrl: string`（规范化 URL，末尾不带 `/`）
- `models: string[]`（空数组=不限制；非空=白名单全等匹配）
- `enabled: boolean`
- `failures: number`
- `cooldownUntil: number`（毫秒时间戳；0=未冷却）
- `createdAt/updatedAt: string`（ISO 时间）

落盘策略：写临时文件 + rename（原子替换）。

注意：每次挑 key 会推进 `rrIndex` 并落盘一次，QPS 高时会产生大量 IO。

---

## 6. 代理转发与失败切换（核心数据流）

入口路由覆盖：

- `/v1/*`、`/chat/*`、`/embeddings`、`/models`

Provider 选择：

- 优先请求头：`x-llm-provider: openai|gemini|deepseek|custom`
- 否则根据 `model` 前缀推断（`gemini-*`、`deepseek-*`）

Key 选择：

- 过滤池（pool）：enabled + provider 匹配 + models 白名单（如配置）
- 轮询：按 `rrIndexByPool[provider+model]` round-robin（向后兼容：若不存在该分池指针，会回退用 `rrIndex`）
- 冷却：挑选时会跳过冷却中的 key；若池内全部 key 在冷却，会选择“最早解除冷却”的 key 继续尝试

转发请求：

- 复制原请求 headers（剔除 host/content-length/authorization）
- 注入 `Authorization: Bearer <apiKey>`
- 拼接 `baseUrl + path`：对所有 provider 都会把请求路径里的 `/v1` 前缀去掉再拼接（避免出现 `/v1/v1/...`）

失败重试/冷却：

- 单请求最多尝试 `poolKeys.length` 次（按当前 provider+model 池）
- 触发冷却并换 key：`429`、`401/403`、`5xx`（其他状态也会计入失败，但冷却时长不同）
- 冷却时长：`429=45s`、`5xx=10s`、`401/403=600s`、其他 `20s`
- 成功：清除 failures / cooldown，记录耗时与统计

---

## 7. 管理 API（/admin）

管理 API 前缀：`/admin/*`，可选鉴权：`ADMIN_TOKEN` + `x-admin-token`。

常用接口（见 server.js）：

- `GET /admin/presets`：预设 providers/baseUrl
- `GET /admin/keys`：返回 keys（apiKey 会 mask）
- `POST /admin/keys`：新增 key
- `PUT /admin/keys/:id`：编辑 key
- `DELETE /admin/keys/:id`：删除 key
- `GET /admin/stats`：聚合统计（成功/失败/冷却/平均耗时等）
- `GET /admin/timeseries`：时序数据（供 UI 画图）

补充：`POST/PUT /admin/keys` 会自动规范化用户输入的 apiKey（去引号、去掉 `Bearer ` 前缀、trim 空白）。

---

## 8. Metrics（Prometheus）

默认 `GET /metrics`。

指标前缀：`llm_api_lb_*`（具体见 server.js 中 prom-client 定义）。

关键指标：
- `llm_api_lb_requests_total`: 请求总数（Labels: status, key_name等）
- `llm_api_lb_key_cooldown`: **新增** 冷却状态 Gauge (1=冷却中, 0=正常)
- `llm_api_lb_request_duration_seconds`: 耗时分布 Histogram
- `llm_api_lb_in_flight`: 当前并发请求数

---

## 9. Launcher 模式（端口占用/可执行文件默认行为）

存在两种运行模式：

- `main`：正常服务（UI + admin + 代理）
- `launcher`：启动页模式（用于端口占用/可执行文件默认启动）

launcher 特征：

- 监听随机端口 `listen(0)`
- 提供 `/launcher/info` 与 `/launcher/start`
- 未启动 main 前，管理/代理接口会返回 `409 service_not_started`

launcher 如何拉起 main：

- `POST /launcher/start {port}` 校验端口可用后，spawn 新进程并设置：
  - `PORT=<port>`
  - `LAUNCHER_MODE=0`
  - `AUTO_OPEN_BROWSER=0`
- launcher 延迟退出

---

## 10. macOS App（.app）实现要点

### 10.1 构建产物

构建命令：

```bash
npm run build:app:mac
```

生成：

- `dist/llm-api-lb.app`
- `dist/llm-api-lb-macos.app.zip`（用于 Release）

### 10.2 `.app` 内部结构

- `Contents/Resources/`：
  - `llm-api-lb-macos-arm64` / `llm-api-lb-macos-x64`（服务端二进制）
  - `public/`（UI 静态资源兜底，避免 pkg 资源丢失导致 `/` 404）
  - `menubar_icon.png`（菜单栏图标，使用 128px 缩放至 22px）
  - `AppIcon.icns`（应用图标）

### 10.3 Swift 启动器职责

- 菜单栏常驻：关闭主窗口不退出（隐藏窗口），从菜单栏打开主界面
- 启动/停止子进程：按架构选择 arm64/x64 的服务端二进制
- 强制状态文件路径：`~/Library/Application Support/llm-api-lb/state.json`
- 启动校验：轮询 `/health` 并校验 `instanceId`，避免误连旧实例导致“已启动但 / 404”
- **Cmd+Q 退出确认**：拦截退出事件，弹出确认弹窗
- **标准菜单**：提供 Edit/Window/Help/About 菜单，解决输入框无法复制粘贴问题

### 10.4 Gatekeeper（未签名）

Release 的 `.app` 未签名/未公证：

- 建议把 app 拖到 `/Applications` 再打开
- 若系统拦截：系统设置 → 隐私与安全性 → “仍要打开”

---

## 11. Release（CI）与发版流程

触发方式：push tag `v*`，CI 会在 macOS/Windows/Linux 构建产物，并创建 GitHub Release。

CI 产物：

- macOS：`llm-api-lb-macos.app.zip`
- Linux：`llm-api-lb-linux-x64`
- Windows：`llm-api-lb-windows-x64.exe`

推荐发版步骤：

1. 确保工作区干净（`git status` 无改动）
2. 更新 `package.json` 版本号
3. 提交并 push main
4. 打 tag（例如 `v0.2.1`）并 push tag（触发 CI release）

---

## 12. 常见问题/排障

- “已启动但 Cannot GET /”：通常是 UI 静态资源找不到或误连旧实例；优先检查 `/health` 返回的 `instanceId` 与端口；确保 `.app` 内 Resources/public 存在。
- “找不到该文件”：通常是从 Downloads 里直接运行/或 Dock 指向旧路径；建议拖到 /Applications 后从应用程序打开，再重新固定 Dock。
- 高并发性能：`rrIndex` 每次请求落盘会有 IO 放大；需要更高性能时可改为内存 rrIndex + 定期落盘。

---

## 13. 版本更新记录 (Recent Updates)

### v0.2.1
- **Feature**: macOS App 顶部栏新增“复制 Base URL”按钮。

### Unreleased (local)
- **Fix**: 所有 provider 统一去掉请求路径 `/v1` 前缀后再拼接上游 baseUrl，避免 `/v1/v1/...`
- **Fix**: API Key 自动规范化（去引号/去 Bearer 前缀/trim）
- **Change**: 轮询改为按 provider+model 分池维护 rr 指针；池内全冷却时选最早解除冷却 key
- **Change**: 单请求重试次数按 poolKeys.length；冷却时长对齐：429=45s、5xx=10s、401/403=600s、其他=20s
- **Test**: 新增 node:test 集成测试（tests/integration.test.js）

### v0.2.0
- **Feature**: macOS App 体验大升级
  - 更换高清菜单栏图标 (128px -> 22px)
  - 修复“访达”菜单问题，显示应用原生菜单
  - 新增 About / Hide / Hide Others 菜单项
- **Fix**: 优化应用激活策略

### v0.1.18 - v0.1.19
- **Feature**: Cmd+Q 退出确认弹窗
- **Feature**: 顶部状态栏提示“应用已在任务栏运行”
- **Fix**: 修复 Edit 菜单缺失导致无法复制粘贴的问题

### v0.1.14 - v0.1.17 (Refactor)
- **Refactor**: 项目重命名 `llm-apikey-lb` -> `llm-api-lb`
- **Fix**: 修复构建脚本输出文件名不匹配导致 CI 失败的问题
- **Doc**: 更新 README 指标说明与 Grafana 查询示例

### v0.1.13
- **Feature**: 监控图表支持区分成功（半透明）与失败（实心）请求
- **Feature**: 新增 Prometheus 指标 `llm_api_lb_key_cooldown`
