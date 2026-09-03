## 后端架构说明（当前实现）

> 本文档描述 **当前代码已落地** 的后端（Electron 主进程 / TS 后端）目录结构与开发规范。  
> 目标：**不改变业务逻辑**前提下，通过目录内聚让代码“高内聚、低耦合、好定位、好扩展”。

补充：如果你想先从一个“宏观入口”开始阅读，再逐步下钻到 DB/IPC/Preload 细节，请先看 `src/README.md`。

---

## 一、后端总体分层（理解代码放哪里）

- **core/**：与业务无关的核心能力（运行时、图引擎、持久化抽象/实现等）。
- **features/**：按业务 Feature 聚合（知识库、workspace 文档、todo、转录等），尽量做到“一个 Feature 自洽拥有自己的 schema/service/仓储实现”。
- **infra/**：通用基础设施与适配器（LLM/ASR、task-queue、vector-store 等），不夹带具体业务规则。
- **electron-main/**：Electron 主进程适配层（IPC、preload、窗口、DB 连接等）。这里是“把 features/core 装配到 Electron 环境里”的地方。
- **shared/**：纯工具与共享定义（logger、utils、共享接口等）。

---

## 二、目录树（后端关键部分）

> 这是**当前状态**的关键目录（只列高信号路径；细节以实际目录为准）。

```text
src/
├── core/
│   ├── persistence/
│   │   └── event-store/
│   │       ├── conversation-schema.provider.ts
│   │       └── schema-providers.ts                 # ✅ 对话表：providers 聚合入口
│   │
│   └── events/
│       └── eventMappers.ts                         # ✅ 运行时事件映射（AgentEvent → RuntimeEvent / memory replay）
│
├── features/
│   ├── workspace/
│   │   └── infrastructure/
│   │       └── sqlite/
│   │           ├── schema-providers.ts             # ✅ Workspace：providers 聚合入口
│   │           ├── workspace-schema.provider.ts    # Workspace 核心表 + 文档表聚合（不写 SQL）
│   │           ├── schemas/
│   │           │   └── core.schema.ts              # projects / workspace_nodes 等核心表 DDL
│   │           └── documents/
│   │               ├── markdown_document/
│   │               │   ├── schemas/
│   │               │   └── services/
│   │               └── mindmap_document/
│   │                   ├── schemas/
│   │                   ├── services/
│   │                   └── mindmap-document-schema.provider.ts
│   │
│   ├── knowledge-base/
│   │   └── infrastructure/
│   │       └── sqlite/
│   │           ├── knowledge-base.schema.ts
│   │           ├── knowledge-base-schema.provider.ts
│   │           └── schema-providers.ts             # ✅ KB：providers 聚合入口
│   │
│   └── project-todo/
│       └── infrastructure/
│           └── sqlite/
│               ├── todo.schema.ts
│               └── todo.service.ts
│
├── infra/
│   ├── task-queue/
│   │   └── workers/
│   └── adapters/
│       ├── asr/
│       ├── llm/
│       │   └── clients/
│       │       └── llm-http-client.ts              # ✅ LLM HTTP 客户端（供各 LLM adapter 复用）
│       └── vector-store/
│           └── qdrant/
│
├── electron-main/
│   ├── services/
│   │   └── database.ts                             # ✅ DatabaseService（集中管理 workspace.sqlite）
│   │   └── database/
│   │       └── migrations.ts                        # ✅ 迁移集中维护（不按 Feature 拆分）
│   │
│   ├── ipc/
│   │   ├── tsHandlers.ts                            # ✅ TS IPC 注册入口（引用 handlers/<feature>/*）
│   │   └── handlers/
│   │       ├── workspace/                           # ✅ workspace handlers（含 documents 子域）
│   │       ├── knowledge-base/
│   │       ├── todo/
│   │       └── system/
│   │
│   └── preload/
│       ├── index.ts                                 # ✅ 聚合入口（exposeInMainWorld）
│       ├── valid-channels.ts                         # ✅ channel allowlist
│       ├── types.ts                                  # preload 层参数类型
│       └── modules/                                  # ✅ 按职责拆分的 preload 模块
│
└── shared/
    ├── logger.ts
    └── database/
        └── schema-provider.ts                        # ✅ ISchemaProvider（shared，避免 core 依赖 electron-main）
```

---

## 三、关键机制说明（避免踩坑）

### 1）数据库：workspace.sqlite 统一，但 “表的归属”按 Feature 管

- **数据库文件**：仍然是单一 `workspace.sqlite`（由 `electron-main/services/database.ts` 管理连接与初始化）。
- **迁移管理**：`electron-main/services/database/migrations.ts` **集中维护**（已确认不按 Feature 拆分）。
- **Schema Provider 注册方式**：
  - `DatabaseService` 不再硬编码 `new XxxSchemaProvider()`。
  - 每个 Feature 提供 `schema-providers.ts`（例如 `getWorkspaceSchemaProviders()`），由 `DatabaseService` 统一收集后执行 DDL。
- **共享接口**：`ISchemaProvider` 放在 `src/shared/database/schema-provider.ts`，避免 `core` 依赖 `electron-main`。

### 2）IPC：按 Feature 聚合（只改路径，不改 channel）

- IPC handlers 统一放在：`src/electron-main/ipc/handlers/<feature>/**`
- TS 注册入口：`src/electron-main/ipc/tsHandlers.ts`  
  这里只做“注册”，不要把业务逻辑写回这里。

### 3）Preload：按职责拆分，入口统一聚合（对外 API 保持稳定）

- 入口：`src/electron-main/preload/index.ts`
- 白名单：`src/electron-main/preload/valid-channels.ts`（必须 gate 所有通用 send/invoke/on）
- 模块：`src/electron-main/preload/modules/*`（system / workspace / todo / kb / block-history 等）

---

## 四、开发规范（必须遵守）

### 1）目录与依赖规则（高内聚、低耦合）

- **Feature 的业务代码必须优先放 `features/<feature>`**：
  - 数据表 DDL / schema provider / sqlite 仓储：放 `features/<feature>/infrastructure/sqlite/**`
  - Electron 侧 IPC/Preload：放 `electron-main/ipc/handlers/<feature>/**` 与 `electron-main/preload/modules/*`
- **electron-main 不应该承载业务规则**：它只负责装配、生命周期、IPC/Preload 适配。
- **core 不依赖 electron-main**：如需共享接口/类型，放到 `shared/`。

### 2）TypeScript 规范

- **禁止使用 `any` 类型断言**（例如 `as any`）。必须阅读真实类型定义，按类型系统约束写代码。
- **新文件优先使用 `.ts`**（除非是纯文档）。
- **中文注释**：关键逻辑、重要数据结构、边界条件必须写清楚“为什么”。

### 3）修改原则（本仓库重构共识）

- **禁止补丁式/防御性修复**：出现问题必须先定位根因，再做结构化修改。
- 结构重构阶段：**只改文件位置、目录结构、import 路径、脚本入口**；不改业务行为、协议、channel 名称。

### 4）新增一个 Feature 的最小步骤（建议流程）

1. 在 `src/features/<new-feature>/` 建立目录与 README（说明边界、数据模型）。
2. 如需落库：
   - 在 `features/<new-feature>/infrastructure/sqlite/` 提供 schema/provider；
   - 新增 `schema-providers.ts` 并被 `DatabaseService` 收集（不要在 `DatabaseService` 里硬编码）。
3. 如需 IPC：
   - 在 `electron-main/ipc/handlers/<new-feature>/` 新增 handler；
   - 在 `electron-main/ipc/tsHandlers.ts` 注册（保持 channel 命名稳定）。
4. 如需 preload：
   - 在 `electron-main/preload/modules/` 新增模块；
   - 在 `valid-channels.ts` 增加白名单；
   - 在 `preload/index.ts` 聚合导出（保持 `window.electronAPI` 兼容）。

