# `.env.local` 开发配置

在项目根目录手动创建 `.env.local`，并只填写当前开发机需要的配置。该文件已被 Git 忽略，禁止提交真实凭据。

发布包不会读取启动 cwd 或仓库中的 dotenv 文件；本指南只服务开发环境。返回[开发指南总览](./README.md)。

## 推荐配置（开发机）

```ini
# 开发模式：只影响路径、热加载和诊断等源码开发行为，不代表官方发行身份
LINNYA_DEV_MODE=true

# 可选：自定义工作区根目录（默认开发模式为 `<项目根>/_dev_data`）
# LINNYA_WORKSPACE_DIR=/Users/you/Documents/Linnya

# ========== 知识图谱调试 ==========
# 开启：把图谱抽取的 LLM 原始输出 + 解析后的 JSON dump 到本地文件
LINNYA_KG_DUMP_JSON=1

# ========== 统一审计 ==========
# 日常使用默认 standard；审计事实与 RuntimeEvent 共用 workspace.sqlite。
# LINNYA_AUDIT_LEVEL=standard
#
# 排查 context-manager / LLM 输入协议问题时临时开启 debug。必须保留开发模式，
# 普通决策继续进入 workspace.sqlite，LLM debug evidence 通过同一个 AuditPort 写入
# `<WorkspaceRoot>/Audit/v1/dev-diagnostics/<conversationId>/<runId>.jsonl`；排查完成后恢复 standard。
# LINNYA_AUDIT_LEVEL=debug

# ========== API Keys（按你实际用到的填） ==========
# OPENAI_API_KEY=sk-...
# FEIAI_GEMINI_API_KEY=...
# DEEPSEEK_API_KEY=...
# FEIAI_DOUBAO_API_KEY=...
# FEIAI_TRANSCRIPTION_API_KEY=...
# SILICONFLOW_EMBEDDING_API_KEY=...
# SILICONFLOW_RERANK_API_KEY=...
# SILICONFLOW_QWEN_VL_API_KEY=...
#
# OpenRouter 可选 header
# OPENROUTER_HTTP_REFERER=...
# OPENROUTER_X_TITLE=...

# ========== Vite / 前端（只影响开发态） ==========
# dev:electron 会自动在 5173/5174 中选择可用端口，并把实际 URL 传给 Electron。
# VITE_DEV_SERVER_URL 是启动编排内部的进程协作变量，不需要写入 .env.local。
```

## 生效位置说明

- **主进程/后端/worker**：开发态启动时由 `src/electron-main/bootstrap-env.ts` 加载；发布包明确跳过 dotenv 文件。
- **前端（Vite）**：Vite 会自动加载 `.env.local`，但只有 `VITE_` 前缀会暴露给 renderer 侧代码。
- **发行身份**：不从 `.env.local` 推导。未打包运行固定为 `source`，未通过受信发行清单验签的安装包固定为 `community`。
