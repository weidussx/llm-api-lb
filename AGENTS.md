# AGENTS.md (Project Rules)

## 项目认知
这是一个混合技术栈项目：
1. **Core**: Node.js (server.js) 处理 HTTP 代理和逻辑。
2. **Wrapper**: Swift (macOS App) 负责管理 Node 进程和原生菜单。

## 关键规则 (Critical Rules)
1. **数据一致性**: 严禁在未检查 [@DATA_SCHEMA.md](docs/ai/DATA_SCHEMA.md) 的情况下修改 `data/state.json` 的读写逻辑。Swift App 强依赖此结构。
2. **进程管理**: 修改端口或启动逻辑时，必须参考 [@MACOS_BRIDGE.md](docs/ai/MACOS_BRIDGE.md)，防止原生 Launcher 无法接管进程。
3. **算法保护**: 涉及 "429 Cooling" 或 "Key Rotation" 的修改，必须严格遵循 [@CORE_LOGIC.md](docs/ai/CORE_LOGIC.md) 中的伪代码定义。
4. **交接机制**: 在结束重要任务或 Context Reset 前，必须更新 [@HANDOVER.md](docs/ai/HANDOVER.md)，记录当前进度、遗留问题和下一步计划。

## 上下文索引
- 任务交接/进度同步 -> 读取/更新 [@HANDOVER.md](docs/ai/HANDOVER.md)
- 修改核心路由/轮询逻辑 -> 读取 [@CORE_LOGIC.md](docs/ai/CORE_LOGIC.md)
- 修改数据存储结构 -> 读取 [@DATA_SCHEMA.md](docs/ai/DATA_SCHEMA.md)
- 修改 macOS 菜单/打包 -> 读取 [@MACOS_BRIDGE.md](docs/ai/MACOS_BRIDGE.md)
- 发布新版本 -> 读取 [@RELEASE.md](docs/ai/RELEASE.md)

## 隔离变更警告 (Isolating Changes)
- **前端 vs 后端**: 如果任务仅涉及 Web UI (HTML/CSS/JS)，**绝对不要**修改 `server.js` 中的 Swift 启动参数或端口绑定逻辑。
- **生产环境**: 不要为了方便测试而将生产环境的代码修改为硬编码（Hardcoding）。
