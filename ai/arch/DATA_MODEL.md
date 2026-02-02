# 系统数据结构说明文档

目前系统中的数据主要分为三大类，分别存储在 `data/` 目录下的不同位置：

### 1. 核心创作数据 (Core Data)
存储于 `data/novel.db` (SQLite数据库)，是小说创作的核心资产。

- **📚 剧情摘要 (Plot Summaries)** : 全书及各章的剧情梗概。
- **👥 角色档案 (Character DB)** : 角色的姓名、等级、状态、关系等详细设定。
- **🗺️ 地图信息 (Map DB)** : 地点、宗门、环境设定。
- **🌍 世界观 (World Settings)** : 宏观背景、修炼体系、历史传说（Markdown 格式）。
- **📅 未来规划 (Future Plans)** : 大的情节未来设定，用于宏观把控剧情走向。
- **🕵️ 剧情后台推测 (Plot Inferences)** : 基于已有剧情的合理推测，用于辅助逻辑链条（JSON 列表）。
- **🕳️ 未填坑 (Unresolved Mysteries)** : 已经发生的剧情里留下的钩子，需要未来补充、解释或召回（JSON 列表）。
- **📜 章节正文 (Chapters)** : 已完成的章节内容。
- **🗄️ 章节正文对象存储 (Blob Store)** : `data/blob_store/chapters/{chapter_ulid}.txt` 保存章节原文，`chapters.content_key` 指向该 key（为未来迁移 D1/R2 预留）。
- **📝 创作草稿 (Drafts)** : 未定稿的片段或草稿。
- **🎨 风格指南 (Style Guide)** : Stylist 学习到的用户专属文风规则（新功能）。
- **🧷 稳定 ID (ULID)** : `chapters.ulid` 为章节提供可迁移的全局唯一标识（用于索引对齐/多端合并预留）。
- **🔎 全文检索 (FTS5)** : `chapters_fts` 为章节提供关键词检索（snippet + bm25 排序）。
- **🧾 操作日志 (Op-log, 骨架)** : `oplog` 记录章节与 KV 写入的操作条目（为未来多端离线合并预留）。

#### 1.1 关系型结构表（实验，落在 `data/novel.db` 内）
项目在 `data/novel.db` 内引入实验性的关系型结构表（SQLAlchemy），与 `kv_store` 同库。

- **用途**：将部分 KV 结构拆解为实体表与关系表（角色/地点/势力/法宝/功法等），用于更强的检索与关联查询。
- **当前定位**：主程序以 `data/novel.db` 为单一事实来源；关系表用于增强检索与一致性，不再引入第二个 DB 文件。
- **实现**：`utils/db_manager.py`
- **迁移脚本**：`scripts/migrate_to_sql.py`（从 `kv_store` 读取并写入同一个 `data/novel.db` 的关系表）

> 备注：`plot_inferences` / `unresolved_mysteries` 已迁移为同库关系表进行读写，KV 中不再作为主事实来源。

### 1.2 索引层（可重建）
索引用于检索加速，不是事实来源；可从 `data/novel.db` 重建：

- **🧠 向量索引 (ChromaDB)** : `data/vector_db/`
  - 用于语义相似检索（氛围/口癖/相似场景）
  - 与 FTS5 共同组成 Hybrid 检索（关键词 + 语义）
  - 重建脚本：`scripts/init_vector_db.py`

### 2. 会话数据 (Session Data)
存储于 `data/chat_sessions/` 目录（JSON文件），用于多窗口管理。

- **💬 聊天记录** : 您与 AI 在不同窗口中的所有对话历史。每个窗口对应一个 `.json` 文件。

### 3. 系统配置与日志 (System & Logs)
存储于 `data/config/` 和 `data/logs/` 等位置。

- **⚙️ 模型配置** : `data/config/model_profiles.json` ，存储您的 API Key、模型参数及智能体绑定关系。
- **📊 用量日志** : `data/logs/usage_stats.json` ，记录 Token 消耗统计。
- **🔧 上下文设置** : `data/context_settings.json` ，存储摘要长度限制等偏好。
- **🔑 环境变量** : `.env` 文件，存储默认的 API Key 等敏感信息。

> **提示**: 所有数据都在本地，您可以随时备份整个 `data/` 目录以确保数据安全。
